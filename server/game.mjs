// The game: rooms, players, turns and the clock. No I/O: the HTTP layer (server/api.mjs) calls
// these functions and streams each player their own view; tests drive it with a fake clock.
//
// A room lives in memory only. A restart (a deploy) ends every game, and an empty room is
// forgotten after half an hour.
//
// Phases: lobby → choose (the drawer picks a word) → draw → reveal (the word, the points) → the
// next turn's choose … → final → (rematch) lobby. Each round, every player draws once.
//
// The word never leaks: every player's stream is built for them (view below). Guessers get the
// blanks and the hints so far; the drawer and whoever has guessed get the word. A right guess is
// never echoed; after it, that player's messages reach only those who know.

import { randomBytes, randomInt as cryptoInt } from 'node:crypto';
import { cleanAvatar, randomAvatar } from './avatar.mjs';
import { hintOrder, hintTimes, judge, pattern } from './guess.mjs';
import { drawerPoints, guessPoints } from './scoring.mjs';
import { applyOps, newDrawing, toOps, H, PALETTE_SIZE, W } from './ink.mjs';
import { CUSTOM_LIMITS, LANGS, PACKS, choices as drawChoices, parseCustom, pool } from './words/index.mjs';

/** Room codes have no vowels, so no code spells a word. */
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

/** classic: skribbl.io's game · blitz: the same, short (a preset the host can still change) */
export const MODES = ['classic', 'blitz'];
export const ROUND_CHOICES = [2, 3, 4, 5, 6, 8, 10];
export const SECOND_CHOICES = [30, 45, 60, 80, 100, 120, 180, 240];
export const WORD_CHOICES = [1, 2, 3, 4, 5];
export const HINT_CHOICES = [0, 1, 2, 3, 4, 5];
/** normal: the blanks show the length · hidden: nothing until the first hint · combo: two words */
export const WORD_MODES = ['normal', 'hidden', 'combo'];
export const DIFFICULTY_CHOICES = ['mixed', 'easy', 'medium', 'hard'];
/** The reactions that float up over the canvas. */
export const REACTIONS = ['👍', '😂', '😮', '🔥', '👏', '🤔'];

const PRESETS = {
  classic: { rounds: 3, seconds: 80, words: 3, hints: 2 },
  blitz: { rounds: 2, seconds: 45, words: 1, hints: 3 },
};

export const DEFAULT_SETTINGS = Object.freeze({
  mode: 'classic',
  ...PRESETS.classic,
  wordMode: 'normal',
  lang: 'de',
  packs: Object.freeze([...PACKS]),
  difficulty: 'mixed',
  custom: '',
  onlyCustom: false,
  nearMiss: true,
});

export const LIMITS = {
  rooms: 200,
  players: 20,
  bots: 8,
  name: 16,
  message: 100,
  roomsPer10Min: 40,
  /** Chat lines a page gets when it (re)connects. */
  backlog: 80,
};

const CHOOSE_MS = 15_000;
const REVEAL_MS = 6_000;
/** Everyone has it: the turn ends after this beat, so the last "got it" can be seen. */
const EARLY_END_MS = 1_200;
/** A drawer whose page has been gone this long loses the turn. */
const DRAWER_GRACE = 20_000;
const HOST_GRACE = 15_000;
const LOBBY_GRACE = 60_000;
const EMPTY_TTL = 30 * 60_000;
const IDLE_TTL = 4 * 60 * 60_000;
const CHAT_WINDOW = 3_000;
const CHAT_MAX = 5;
const REACT_GAP = 250;

const BOT_NAMES = ['Robo Rita', 'Bot Bernd', 'Pixel Paula', 'Kritzel-Karl', 'Tinte Tom', 'Skizzen-Sam', 'Krakel-Kim', 'Feder Fritz'];
const BOT_MISSES = ['hmm', 'Haus?', 'ein Tier?', 'Baum', 'Auto', 'keine Ahnung', 'Sonne?', 'Katze'];

export class GameError extends Error {
  /** @param {string} code  @param {number} [status] */
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * @typedef {{ now(): number, setTimeout(fn: () => void, ms: number): any, clearTimeout(handle: any): void }} Clock
 * @typedef {{ player: string | null, send(event: string, data: string): void }} Subscriber
 */

const realClock = { now: Date.now, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h) };

/**
 * @param {{ clock?: Clock, randomInt?: (n: number) => number }} [options]
 *   randomInt picks words, bots' moves and hints (tests pass a seeded one)
 */
export function createGames({ clock = realClock, randomInt = (n) => cryptoInt(n) } = {}) {
  /** @type {Map<string, any>} */
  const rooms = new Map();
  const created = [];
  const random = () => randomInt(1_000_000) / 1_000_000;

  // ---- helpers ------------------------------------------------------------------------------

  function room(code) {
    const r = rooms.get(String(code ?? '').toUpperCase());
    if (!r) throw new GameError('no-room', 404);
    return r;
  }

  function within(stamps, windowMs, limit) {
    const t = clock.now();
    while (stamps.length && stamps[0] <= t - windowMs) stamps.shift();
    if (stamps.length >= limit) return false;
    stamps.push(t);
    return true;
  }

  function newCode() {
    for (let i = 0; i < 100; i++) {
      let code = '';
      for (let j = 0; j < 4; j++) code += CODE_LETTERS[cryptoInt(CODE_LETTERS.length)];
      if (!rooms.has(code)) return code;
    }
    throw new GameError('busy', 503);
  }

  function player(r, token) {
    if (typeof token !== 'string' || !token) throw new GameError('no-player', 401);
    for (const p of r.players.values()) if (p.token === token && !p.left && !p.bot) return p;
    throw new GameError('no-player', 401);
  }

  function requireHost(r, p) {
    if (r.host !== p.id) throw new GameError('not-host', 403);
  }

  function requirePhase(r, ...phases) {
    if (!phases.includes(r.phase)) throw new GameError('wrong-phase', 409);
  }

  /** Players who are still in the room, in the order they joined. */
  function present(r) {
    return [...r.players.values()].filter((p) => !p.left);
  }

  const isOnline = (p) => p.bot || p.online > 0;

  function addPlayer(r, rawName, rawAvatar, bot = false) {
    if (present(r).length >= LIMITS.players) throw new GameError('room-full', 409);
    const base = cleanName(rawName);
    if (!base) throw new GameError('name');
    const taken = new Set(present(r).map((p) => p.name.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
    const p = {
      id: randomBytes(6).toString('base64url'),
      token: bot ? '' : randomBytes(18).toString('base64url'),
      name,
      avatar: cleanAvatar(rawAvatar, random),
      bot,
      score: 0,
      joined: clock.now(),
      online: 0,
      offlineSince: clock.now(),
      left: false,
      chats: [],
      reacted: 0,
      close: 0,
    };
    r.players.set(p.id, p);
    // Someone arriving mid-game draws later this round.
    if (r.game && r.phase !== 'final') r.game.queue.push(p.id);
    return p;
  }

  function touch(r) {
    r.touched = clock.now();
    r.version++;
    broadcast(r);
  }

  function later(r, ms, fn) {
    const handle = clock.setTimeout(() => {
      r.timers.delete(handle);
      if (rooms.get(r.code) === r) fn();
    }, ms);
    r.timers.add(handle);
    return handle;
  }

  function clearTimers(r) {
    for (const handle of r.timers) clock.clearTimeout(handle);
    r.timers.clear();
  }

  // ---- what each page gets ------------------------------------------------------------------

  /** @param {any} r  @param {any | null} viewer  the player whose page this is; null for the big screen */
  function view(r, viewer) {
    const t = r.turn;
    const me = viewer && !viewer.left ? viewer : null;
    const host = me?.id === r.host;
    return {
      code: r.code,
      phase: r.phase,
      version: r.version,
      host: r.host,
      me: me?.id ?? null,
      // The host's own words would give the game away: the others only see how many there are.
      settings: { ...r.settings, packs: [...r.settings.packs], custom: host ? r.settings.custom : '', customCount: r.customCount },
      notice: r.notice,
      players: present(r).map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        score: p.score,
        online: isOnline(p),
        bot: p.bot,
        guessed: Boolean(t && t.guessed.has(p.id)),
        points: t?.phase === 'reveal' ? (t.points.get(p.id) ?? 0) : null,
      })),
      game: r.game ? { mode: r.game.mode, rounds: r.game.rounds, round: r.game.round } : null,
      turn: t ? turnView(r, t, me) : null,
      final: r.phase === 'final' ? finalView(r) : null,
      reactions: REACTIONS,
      now: clock.now(),
    };
  }

  function turnView(r, t, me) {
    const base = { n: t.n, round: t.round, drawer: t.drawer, phase: t.phase };
    if (t.phase === 'choose') {
      return {
        ...base,
        endsAt: t.chooseEndsAt,
        choices: me?.id === t.drawer ? t.choices.map((c) => ({ word: c.word, difficulty: c.difficulty })) : null,
      };
    }
    const knows = Boolean(me && (t.drawer === me.id || t.guessed.has(me.id)));
    const word = t.phase === 'reveal' || knows ? t.entry.word : null;
    const hidden = !word && r.settings.wordMode === 'hidden' && t.shown === 0;
    let likes = 0;
    let dislikes = 0;
    for (const v of t.likes.values()) v > 0 ? likes++ : dislikes++;
    return {
      ...base,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      difficulty: t.entry.difficulty,
      word,
      pattern: word || hidden ? null : pattern(t.entry.word, t.revealed),
      hints: t.shown,
      hintsTotal: t.hints.length,
      guessed: t.guessed.size,
      like: me ? (t.likes.get(me.id) ?? 0) : 0,
      likes,
      dislikes,
      ended: t.ended,
      revealEndsAt: t.revealEndsAt ?? null,
    };
  }

  function finalView(r) {
    return {
      awards: r.awards,
      drawings: r.gallery.map((g) => ({ n: g.n, round: g.round, drawer: g.drawer, word: g.word, difficulty: g.difficulty, likes: g.likes, dislikes: g.dislikes, guessed: g.guessed, possible: g.possible })),
    };
  }

  function broadcast(r) {
    for (const s of r.subscribers) {
      const p = s.player ? r.players.get(s.player) : null;
      s.send('view', JSON.stringify(view(r, p)));
    }
  }

  // ---- chat ---------------------------------------------------------------------------------

  /**
   * One chat line, delivered to everyone (`to` null) or to a set of players. Kinds: msg (someone's
   * words), guessed (got it), close and half (only to the guesser), join, leave, word (the turn's
   * word at its end), skip (the turn was skipped), host (a new host).
   */
  function post(r, kind, playerId, text = '', to = null) {
    const line = { id: ++r.chatSeq, kind, player: playerId, text, to, at: clock.now() };
    r.chat.push(line);
    if (r.chat.length > LIMITS.backlog) r.chat.shift();
    const data = JSON.stringify({ lines: [shownLine(line)] });
    for (const s of r.subscribers) if (sees(line, s.player)) s.send('chat', data);
  }

  const sees = (line, playerId) => !line.to || (playerId !== null && line.to.has(playerId));
  const shownLine = (line) => ({ id: line.id, kind: line.kind, player: line.player, text: line.text, private: Boolean(line.to), at: line.at });

  /** Whoever knows the word right now: the drawer and those who've guessed it. */
  function knowers(t) {
    return new Set([t.drawer, ...t.guessed.keys()]);
  }

  function say(r, p, raw) {
    const text = cleanText(raw, LIMITS.message);
    if (!text) throw new GameError('empty');
    if (!p.bot && !within(p.chats, CHAT_WINDOW, CHAT_MAX)) throw new GameError('slow-down', 429);
    const t = r.turn;
    if (r.phase === 'draw' && t) {
      const knows = t.drawer === p.id || t.guessed.has(p.id);
      const result = judge(t.entry, text);
      if (knows) {
        // The drawer, or someone who has it, can't hand the word out.
        if (result) throw new GameError('spoiler', 409);
        post(r, 'msg', p.id, text, knowers(t));
        return;
      }
      if (result === 'right') {
        guessed(r, p);
        return;
      }
      if (result === 'half') {
        // Half of a combination would tell everyone that half: only those who know see it.
        post(r, 'msg', p.id, text, new Set([...knowers(t), p.id]));
        if (r.settings.nearMiss) post(r, 'half', p.id, text, new Set([p.id]));
        return;
      }
      post(r, 'msg', p.id, text);
      if (result === 'close') {
        p.close++;
        if (r.settings.nearMiss) post(r, 'close', p.id, text, new Set([p.id]));
      }
      return;
    }
    post(r, 'msg', p.id, text);
  }

  function guessed(r, p) {
    const t = r.turn;
    const now = clock.now();
    const total = t.endsAt - t.startsAt;
    const order = t.guessed.size;
    const points = guessPoints({ left: t.endsAt - now, total, order, difficulty: t.entry.difficulty });
    t.guessed.set(p.id, { ms: now - t.startsAt, points, order });
    post(r, 'guessed', p.id);
    touch(r);
    maybeEnd(r);
  }

  // ---- turns --------------------------------------------------------------------------------

  function startGame(r) {
    const people = present(r);
    if (people.length < 2) throw new GameError('too-few', 409);
    const words = pool(r.settings);
    if (r.settings.onlyCustom && words.length < CUSTOM_LIMITS.min) throw new GameError('custom-few', 409);
    if (words.length < (r.settings.wordMode === 'combo' ? 2 : 1)) throw new GameError('no-words', 409);
    clearTimers(r);
    r.game = { mode: r.settings.mode, rounds: r.settings.rounds, round: 0, queue: [], seen: new Set(), words, n: 0 };
    r.gallery = [];
    r.awards = null;
    r.notice = null;
    for (const p of r.players.values()) {
      p.score = 0;
      p.close = 0;
    }
    nextRound(r);
  }

  function nextRound(r) {
    r.game.round++;
    if (r.game.round > r.game.rounds) return finish(r);
    r.game.queue = present(r).map((p) => p.id);
    nextTurn(r);
  }

  function nextTurn(r) {
    clearTimers(r);
    const game = r.game;
    let drawer = null;
    while (game.queue.length && !drawer) {
      const p = r.players.get(game.queue.shift());
      // Someone whose page is only reconnecting keeps the turn; gone for a while, they're skipped.
      const gone = p && !isOnline(p) && p.offlineSince !== null && clock.now() - p.offlineSince >= DRAWER_GRACE;
      if (p && !p.left && !gone) drawer = p;
    }
    if (!drawer) return nextRound(r);
    if (present(r).length < 2) return finish(r);
    const options = drawChoices(game.words, r.settings.words, game.seen, r.settings.wordMode === 'combo', randomInt);
    if (!options.length) return finish(r);
    const now = clock.now();
    r.turn = {
      n: ++game.n,
      round: game.round,
      drawer: drawer.id,
      phase: 'choose',
      choices: options,
      chooseEndsAt: now + CHOOSE_MS,
      entry: null,
      startsAt: 0,
      endsAt: 0,
      hints: [],
      hintAt: [],
      shown: 0,
      revealed: new Set(),
      guessed: new Map(),
      points: new Map(),
      likes: new Map(),
      drawing: newDrawing(),
      ended: null,
      ending: false,
    };
    r.phase = 'choose';
    later(r, CHOOSE_MS, () => {
      if (r.phase === 'choose') choose(r, randomInt(r.turn.choices.length));
    });
    if (drawer.bot) later(r, 1200 + randomInt(1500), () => r.phase === 'choose' && choose(r, randomInt(r.turn.choices.length)));
    touch(r);
  }

  function choose(r, index) {
    const t = r.turn;
    t.entry = t.choices[index];
    for (const e of t.entry.parts ?? [t.entry]) r.game.seen.add(e.word);
    clearTimers(r);
    const now = clock.now();
    const total = r.settings.seconds * 1000;
    t.phase = 'draw';
    t.startsAt = now;
    t.endsAt = now + total;
    t.hints = hintOrder(t.entry.word, r.settings.hints, random);
    t.hintAt = hintTimes(t.hints.length, total, r.game.mode === 'blitz');
    r.phase = 'draw';
    later(r, total, () => endTurn(r, 'time'));
    t.hintAt.forEach((at, i) =>
      later(r, at, () => {
        if (r.turn !== t || t.phase !== 'draw') return;
        t.shown = i + 1;
        t.revealed.add(t.hints[i]);
        touch(r);
      }),
    );
    playBots(r, t);
    touch(r);
    sendCanvas(r);
  }

  /** Everyone who could guess has it: end after a beat. */
  function maybeEnd(r) {
    const t = r.turn;
    if (r.phase !== 'draw' || !t || t.ending) return;
    const guessers = present(r).filter((p) => p.id !== t.drawer && isOnline(p));
    if (!guessers.length || guessers.some((p) => !t.guessed.has(p.id))) return;
    t.ending = true;
    later(r, EARLY_END_MS, () => endTurn(r, 'all'));
  }

  /** @param {'time' | 'all' | 'skip' | 'drawer-gone'} reason */
  function endTurn(r, reason) {
    const t = r.turn;
    if (!t || (t.phase !== 'draw' && t.phase !== 'choose')) return;
    clearTimers(r);
    if (t.phase === 'choose') {
      // No word was drawn: straight on to the next turn.
      post(r, 'skip', t.drawer);
      r.turn = null;
      nextTurn(r);
      return;
    }
    const drawer = r.players.get(t.drawer);
    const possible = Math.max(t.guessed.size, present(r).filter((p) => p.id !== t.drawer).length);
    const won = [...t.guessed.values()].map((g) => g.points);
    for (const [id, g] of t.guessed) {
      const p = r.players.get(id);
      if (p) p.score += g.points;
      t.points.set(id, g.points);
    }
    const forDrawer = reason === 'skip' || reason === 'drawer-gone' ? 0 : drawerPoints(won, possible);
    if (drawer) drawer.score += forDrawer;
    t.points.set(t.drawer, forDrawer);
    t.phase = 'reveal';
    t.ended = reason;
    t.revealEndsAt = clock.now() + REVEAL_MS;
    r.phase = 'reveal';
    const first = [...t.guessed.entries()].sort((a, b) => a[1].ms - b[1].ms)[0];
    r.gallery.push({
      n: t.n,
      round: t.round,
      drawer: t.drawer,
      drawerName: drawer?.name ?? '',
      word: t.entry.word,
      difficulty: t.entry.difficulty,
      drawing: t.drawing,
      turn: t,
      likes: 0,
      dislikes: 0,
      guessed: t.guessed.size,
      possible,
      first: first ? { player: first[0], ms: first[1].ms } : null,
    });
    post(r, reason === 'skip' ? 'skip' : 'word', t.drawer, t.entry.word);
    later(r, REVEAL_MS, () => {
      if (r.phase === 'reveal') nextTurn(r);
    });
    touch(r);
  }

  function finish(r) {
    clearTimers(r);
    r.phase = 'final';
    r.turn = null;
    if (r.game) r.game.queue = [];
    for (const g of r.gallery) {
      g.likes = 0;
      g.dislikes = 0;
      for (const v of g.turn.likes.values()) v > 0 ? g.likes++ : g.dislikes++;
    }
    r.awards = awards(r);
    touch(r);
  }

  function awards(r) {
    const out = {};
    const liked = [...r.gallery].filter((g) => g.likes > 0).sort((a, b) => b.likes - b.dislikes - (a.likes - a.dislikes) || a.n - b.n)[0];
    if (liked) out.liked = { n: liked.n, drawer: liked.drawer, word: liked.word, likes: liked.likes };
    const fastest = r.gallery.filter((g) => g.first).sort((a, b) => a.first.ms - b.first.ms)[0];
    if (fastest) out.fastest = { player: fastest.first.player, ms: fastest.first.ms, word: fastest.word };
    const close = present(r).filter((p) => p.close > 0).sort((a, b) => b.close - a.close)[0];
    if (close) out.close = { player: close.id, count: close.close };
    const unsolved = r.gallery.find((g) => g.guessed === 0);
    if (unsolved) out.unsolved = { n: unsolved.n, drawer: unsolved.drawer, word: unsolved.word };
    return out;
  }

  // ---- ink ----------------------------------------------------------------------------------

  function sendInk(r, n, ops) {
    if (!ops.length) return;
    const data = JSON.stringify({ turn: n, ops });
    for (const s of r.subscribers) if (s.player !== r.turn?.drawer) s.send('ink', data);
  }

  /** The drawing so far, for a page that arrives or comes back (or a new turn's empty canvas). */
  function canvasFor(r) {
    const t = r.turn;
    if (!t || t.phase === 'choose') return null;
    return JSON.stringify({ turn: t.n, ops: toOps(t.drawing) });
  }

  function sendCanvas(r) {
    const data = canvasFor(r);
    if (!data) return;
    for (const s of r.subscribers) s.send('canvas', data);
  }

  // ---- bots ---------------------------------------------------------------------------------

  /** Bots try the game out: random squiggles when they draw, the odd miss and a likely right guess. */
  function playBots(r, t) {
    const total = t.endsAt - t.startsAt;
    const drawer = r.players.get(t.drawer);
    if (drawer?.bot) {
      for (let k = 0; k < 9; k++) {
        later(r, 500 + k * Math.min(1100, total / 12), () => {
          if (r.turn !== t || t.phase !== 'draw') return;
          sendInk(r, t.n, applyOps(t.drawing, squiggle(t, 1000 + k)));
        });
      }
    }
    for (const p of present(r)) {
      if (!p.bot || p.id === t.drawer) continue;
      later(r, total * (0.1 + random() * 0.4), () => {
        if (r.turn === t && t.phase === 'draw' && !t.guessed.has(p.id)) safeSay(r, p, BOT_MISSES[randomInt(BOT_MISSES.length)]);
      });
      if (random() < 0.75) {
        later(r, total * (0.25 + random() * 0.6), () => {
          if (r.turn === t && t.phase === 'draw' && !t.guessed.has(p.id)) guessed(r, p);
        });
      }
    }
  }

  function safeSay(r, p, text) {
    try {
      say(r, p, text);
    } catch {
      // A bot's miss that happens to be right, or a spoiler: it just doesn't say it.
    }
  }

  function squiggle(t, id) {
    const at = () => clock.now() - t.startsAt;
    let x = 120 + randomInt(W - 240);
    let y = 100 + randomInt(H - 200);
    const ops = [['s', id, randomInt(PALETTE_SIZE), randomInt(3), x, y, at()]];
    const pts = [];
    for (let i = 0; i < 14; i++) {
      x = Math.min(W, Math.max(0, x + randomInt(81) - 40));
      y = Math.min(H, Math.max(0, y + randomInt(61) - 30));
      pts.push(x, y, at() + i * 16);
    }
    ops.push(['p', id, ...pts]);
    return ops;
  }

  // ---- host and housekeeping ----------------------------------------------------------------

  function handOver(r) {
    const host = r.players.get(r.host);
    if (host && !host.left && host.online > 0) return;
    const next = present(r).find((p) => !p.bot && p.online > 0);
    if (next && next.id !== r.host) {
      r.host = next.id;
      post(r, 'host', next.id);
      touch(r);
    }
  }

  function removePlayer(r, p) {
    const inLobby = r.phase === 'lobby';
    if (inLobby) r.players.delete(p.id);
    else p.left = true;
    p.online = 0;
    if (!p.bot) post(r, 'leave', p.id, p.name);
    const people = present(r).filter((q) => !q.bot);
    if (!people.length) {
      clearTimers(r);
      rooms.delete(r.code);
      for (const s of r.subscribers) s.send('view', JSON.stringify({ code: r.code, phase: 'gone' }));
      return;
    }
    if (r.host === p.id) r.host = (people.find((q) => q.online > 0) ?? people[0]).id;
    if (r.game && r.phase !== 'final' && present(r).length < 2) return finish(r);
    if (r.turn && r.turn.drawer === p.id && (r.phase === 'draw' || r.phase === 'choose')) return endTurn(r, 'drawer-gone');
    touch(r);
    maybeEnd(r);
  }

  return {
    get size() {
      return rooms.size;
    },

    /** @param {{ name: unknown, avatar?: unknown }} body */
    create({ name, avatar }) {
      if (!cleanName(name)) throw new GameError('name');
      if (rooms.size >= LIMITS.rooms || !within(created, 10 * 60_000, LIMITS.roomsPer10Min)) throw new GameError('busy', 429);
      const code = newCode();
      const r = {
        code,
        created: clock.now(),
        touched: clock.now(),
        version: 0,
        host: '',
        players: new Map(),
        settings: { ...DEFAULT_SETTINGS, packs: [...DEFAULT_SETTINGS.packs] },
        customCount: 0,
        phase: 'lobby',
        game: null,
        turn: null,
        gallery: [],
        awards: null,
        chat: [],
        chatSeq: 0,
        notice: null,
        timers: new Set(),
        subscribers: new Set(),
      };
      rooms.set(code, r);
      const p = addPlayer(r, name, avatar);
      r.host = p.id;
      return { code, player: p.id, token: p.token };
    },

    /** A quick look before joining: does the room exist, and is it open? */
    info(code) {
      const r = rooms.get(String(code ?? '').toUpperCase());
      if (!r) return null;
      return { code: r.code, phase: r.phase, players: present(r).length, full: present(r).length >= LIMITS.players };
    },

    /**
     * Joins, or comes back: a known token gets the same seat (and score) again. A token alone that
     * no longer fits (kicked, or dropped from the lobby) is refused.
     * @param {{ name?: unknown, avatar?: unknown, token?: unknown }} body
     */
    join(code, { name, avatar, token }) {
      const r = room(code);
      if (typeof token === 'string' && token) {
        for (const p of r.players.values()) {
          if (p.token === token && !p.left && !p.bot) return { code: r.code, player: p.id, token: p.token };
        }
        if (!cleanName(name)) throw new GameError('no-player', 401);
      }
      const p = addPlayer(r, name, avatar);
      post(r, 'join', p.id, p.name);
      touch(r);
      return { code: r.code, player: p.id, token: p.token };
    },

    view(code, playerId = null) {
      const r = room(code);
      return view(r, playerId ? (r.players.get(playerId) ?? null) : null);
    },

    /** The finished game's drawings, for the gallery (only once the game is over). */
    gallery(code) {
      const r = room(code);
      if (r.phase !== 'final') throw new GameError('wrong-phase', 409);
      return r.gallery.map((g) => ({ n: g.n, drawer: g.drawer, word: g.word, ops: toOps(g.drawing) }));
    },

    /**
     * Streams the room to one page: its view now and after every change ('view'), the drawing
     * ('canvas' whole, then 'ink' as it grows), chat lines ('chat') and reactions ('react').
     * Returns the unsubscribe function.
     * @param {(event: string, data: string) => void} send
     */
    subscribe(code, playerId, send) {
      const r = room(code);
      const p = r.players.get(String(playerId ?? ''));
      const me = p && !p.left && !p.bot ? p : null;
      /** @type {Subscriber} */
      const sub = { player: me?.id ?? null, send };
      r.subscribers.add(sub);
      if (me) {
        me.online++;
        me.offlineSince = null;
      }
      send('view', JSON.stringify(view(r, me)));
      const canvas = canvasFor(r);
      if (canvas) send('canvas', canvas);
      const lines = r.chat.filter((line) => sees(line, sub.player)).map(shownLine);
      if (lines.length) send('chat', JSON.stringify({ lines, backlog: true }));
      if (me && me.online === 1) touch(r);
      return () => {
        if (!r.subscribers.delete(sub)) return;
        if (me && !me.left) {
          me.online = Math.max(0, me.online - 1);
          if (me.online === 0) {
            me.offlineSince = clock.now();
            touch(r);
            maybeEnd(r);
          }
        }
      };
    },

    /**
     * A player's move. Throws GameError for anything not allowed right now.
     * @param {string} code  @param {unknown} token  @param {string} action  @param {any} body
     */
    act(code, token, action, body = {}) {
      const r = room(code);
      const p = player(r, token);
      r.touched = clock.now();

      switch (action) {
        case 'settings': {
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          r.settings = mergeSettings(r.settings, body);
          r.customCount = parseCustom(r.settings.custom).length;
          r.notice = null;
          touch(r);
          return;
        }
        case 'start': {
          requireHost(r, p);
          requirePhase(r, 'lobby');
          startGame(r);
          return;
        }
        case 'choose': {
          requirePhase(r, 'choose');
          if (r.turn.drawer !== p.id) throw new GameError('not-drawer', 403);
          const index = body?.index;
          if (!Number.isInteger(index) || index < 0 || index >= r.turn.choices.length) throw new GameError('choice');
          choose(r, index);
          return;
        }
        case 'chat': {
          say(r, p, body?.text);
          return;
        }
        case 'ink': {
          requirePhase(r, 'draw');
          if (r.turn.drawer !== p.id) throw new GameError('not-drawer', 403);
          // A batch from a turn that's over (sent just as time ran out) is dropped quietly.
          if (body?.turn !== r.turn.n) return;
          sendInk(r, r.turn.n, applyOps(r.turn.drawing, body?.ops));
          return;
        }
        case 'like': {
          requirePhase(r, 'draw', 'reveal');
          if (r.turn.drawer === p.id) throw new GameError('own-drawing', 409);
          const value = body?.value;
          if (value !== 1 && value !== -1 && value !== 0) throw new GameError('like');
          if (value) r.turn.likes.set(p.id, value);
          else r.turn.likes.delete(p.id);
          touch(r);
          return;
        }
        case 'react': {
          const e = body?.e;
          if (!Number.isInteger(e) || e < 0 || e >= REACTIONS.length) throw new GameError('react');
          const now = clock.now();
          if (now - p.reacted < REACT_GAP) return;
          p.reacted = now;
          const data = JSON.stringify({ player: p.id, e });
          for (const s of r.subscribers) s.send('react', data);
          return;
        }
        case 'skip': {
          requireHost(r, p);
          requirePhase(r, 'choose', 'draw');
          endTurn(r, 'skip');
          return;
        }
        case 'rematch': {
          requireHost(r, p);
          requirePhase(r, 'final');
          clearTimers(r);
          r.phase = 'lobby';
          r.game = null;
          r.turn = null;
          r.gallery = [];
          r.awards = null;
          for (const q of [...r.players.values()]) {
            if (q.left) r.players.delete(q.id);
            q.score = 0;
            q.close = 0;
          }
          touch(r);
          return;
        }
        case 'bot': {
          requireHost(r, p);
          requirePhase(r, 'lobby');
          const bots = present(r).filter((q) => q.bot);
          if (body?.add) {
            if (bots.length >= LIMITS.bots) throw new GameError('bots', 409);
            const used = new Set(bots.map((b) => b.name));
            const name = BOT_NAMES.find((n) => !used.has(n)) ?? BOT_NAMES[0];
            addPlayer(r, name, randomAvatar(random), true);
            touch(r);
          } else if (bots.length) {
            removePlayer(r, bots.at(-1));
          }
          return;
        }
        case 'avatar': {
          p.avatar = cleanAvatar(body?.avatar, random);
          touch(r);
          return;
        }
        case 'kick': {
          requireHost(r, p);
          const target = r.players.get(String(body?.player ?? ''));
          if (!target || target.left || target.id === p.id) throw new GameError('no-player', 404);
          removePlayer(r, target);
          return;
        }
        case 'leave': {
          removePlayer(r, p);
          return;
        }
        default:
          throw new GameError('unknown-action', 404);
      }
    },

    /**
     * Housekeeping, every few seconds: hand the host's seat on, drop people who closed the page
     * in the lobby, end a turn whose drawer is gone, forget empty rooms, and catch a lost timer.
     */
    tick() {
      const now = clock.now();
      for (const r of rooms.values()) {
        const online = present(r).filter((p) => !p.bot && p.online > 0);
        if ((!online.length && now - r.touched > EMPTY_TTL) || now - r.touched > IDLE_TTL) {
          clearTimers(r);
          for (const s of r.subscribers) s.send('view', JSON.stringify({ code: r.code, phase: 'gone' }));
          rooms.delete(r.code);
          continue;
        }
        const host = r.players.get(r.host);
        if (host && host.online === 0 && host.offlineSince !== null && now - host.offlineSince >= HOST_GRACE) handOver(r);
        if (r.phase === 'lobby') {
          for (const p of present(r)) {
            if (!p.bot && p.id !== r.host && p.online === 0 && p.offlineSince !== null && now - p.offlineSince >= LOBBY_GRACE) removePlayer(r, p);
          }
        }
        const t = r.turn;
        if (t && (r.phase === 'draw' || r.phase === 'choose')) {
          const drawer = r.players.get(t.drawer);
          if (drawer && !drawer.bot && drawer.online === 0 && drawer.offlineSince !== null && now - drawer.offlineSince >= DRAWER_GRACE) endTurn(r, 'drawer-gone');
          else if (r.phase === 'draw' && now >= t.endsAt + 2000) endTurn(r, 'time');
          else if (r.phase === 'choose' && now >= t.chooseEndsAt + 2000) choose(r, randomInt(t.choices.length));
        } else if (r.phase === 'reveal' && t && now >= t.revealEndsAt + 2000) nextTurn(r);
      }
    },

    /** Stops every timer (shutdown, tests). */
    close() {
      for (const r of rooms.values()) {
        clearTimers(r);
        r.subscribers.clear();
      }
      rooms.clear();
    },
  };
}

/**
 * A display name: printable, single-spaced, at most LIMITS.name characters (graphemes, so an
 * emoji counts as one). Empty when nothing usable is left.
 */
export function cleanName(raw) {
  return cleanText(raw, LIMITS.name);
}

/** Printable, single-spaced text of at most `max` graphemes. */
export function cleanText(raw, max) {
  if (typeof raw !== 'string') return '';
  const text = raw
    .slice(0, max * 8)
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Co}\p{Cn}]|(?!‍)\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const graphemes = [...new Intl.Segmenter('de', { granularity: 'grapheme' }).segment(text)].map((s) => s.segment);
  return graphemes.slice(0, max).join('').trim();
}

/** The settings with a host's changes applied; anything invalid is ignored. */
export function mergeSettings(current, body) {
  const next = { ...current, packs: [...current.packs] };
  if (MODES.includes(body?.mode) && body.mode !== current.mode) {
    // Picking a mode loads its preset; the host can change any of it afterwards.
    next.mode = body.mode;
    Object.assign(next, PRESETS[body.mode]);
  }
  if (ROUND_CHOICES.includes(body?.rounds)) next.rounds = body.rounds;
  if (SECOND_CHOICES.includes(body?.seconds)) next.seconds = body.seconds;
  if (WORD_CHOICES.includes(body?.words)) next.words = body.words;
  if (HINT_CHOICES.includes(body?.hints)) next.hints = body.hints;
  if (WORD_MODES.includes(body?.wordMode)) next.wordMode = body.wordMode;
  if (DIFFICULTY_CHOICES.includes(body?.difficulty)) next.difficulty = body.difficulty;
  if (LANGS.includes(body?.lang)) next.lang = body.lang;
  if (Array.isArray(body?.packs)) next.packs = PACKS.filter((key) => body.packs.includes(key));
  if (typeof body?.custom === 'string') next.custom = parseCustom(body.custom).join(', ');
  if (typeof body?.onlyCustom === 'boolean') next.onlyCustom = body.onlyCustom;
  if (typeof body?.nearMiss === 'boolean') next.nearMiss = body.nearMiss;
  return next;
}
