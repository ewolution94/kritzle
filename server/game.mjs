// The game: rooms, players, turns and the clock. No I/O: the HTTP layer (server/api.mjs) calls
// these functions and streams each player their own view; tests drive it with a fake clock.
//
// A room lives in memory only. A restart (a deploy) ends every game, and an empty room is
// forgotten after half an hour.
//
// Four modes (settings.mode), each a turn of its own kind (turn.kind):
//   classic, blitz  skribbl.io's game: lobby → choose → draw → reveal → … → final. Each round,
//                   every player draws once. Blitz is a preset of the same.
//   duel            Team duel: each team's drawer draws the same word at the same moment on the
//                   team's own canvas; teammates guess in the team's chat; the first team scores most.
//   forger          Fälscher: everyone but the forger knows the word; in turns each adds one stroke
//                   to one shared drawing; then everyone points at the forger, who, caught, may still
//                   name the word. Phases forge → vote → (unmask) → reveal.
//   telephone       Stille Post: everyone writes a phrase, draws the phrase they're handed,
//                   describes the drawing they're handed, and so on, all at once on a clock; then the
//                   host steps through every chain while everyone watches. Phases tell → showcase.
// Würze (settings.spice) changes how a classic or duel turn is drawn: one stroke, little ink, three
// colours, blind, mirrored, shaky. Some of it the server enforces (spiceFilter), the rest is the
// drawer's page.
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

export const MODES = ['classic', 'blitz', 'forger', 'duel', 'telephone'];
export const ROUND_CHOICES = [2, 3, 4, 5, 6, 8, 10];
export const SECOND_CHOICES = [30, 45, 60, 80, 100, 120, 180, 240];
export const WORD_CHOICES = [1, 2, 3, 4, 5];
export const HINT_CHOICES = [0, 1, 2, 3, 4, 5];
/** normal: the blanks show the length · hidden: nothing until the first hint · combo: two words */
export const WORD_MODES = ['normal', 'hidden', 'combo'];
export const DIFFICULTY_CHOICES = ['mixed', 'easy', 'medium', 'hard'];
/** The reactions that float up over the canvas. */
export const REACTIONS = ['👍', '😂', '😮', '🔥', '👏', '🤔'];
/** Würze: how a turn is drawn. */
export const SPICES = ['blind', 'oneline', 'ink', 'three', 'mirror', 'shaky'];
export const SPICE_CHOICES = ['off', 'random', ...SPICES];
export const TEAM_CHOICES = [2, 3, 4];
/** Fälscher: laps round the table, and seconds for one stroke. */
export const LAP_CHOICES = [1, 2, 3];
export const STROKE_CHOICES = [10, 15, 20];

const PRESETS = {
  classic: { rounds: 3, seconds: 80, words: 3, hints: 2 },
  blitz: { rounds: 2, seconds: 45, words: 1, hints: 3 },
  forger: { rounds: 3, laps: 2, strokeSeconds: 15 },
  duel: { rounds: 2, seconds: 80, hints: 2 },
  telephone: { seconds: 80 },
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
  spice: 'off',
  teams: 2,
  laps: 2,
  strokeSeconds: 15,
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
/** Würze "Wenig Tinte": points a whole drawing may have. */
export const INK_BUDGET = 240;
const PAPER = 3;
/** The colours "Drei Farben" draws from (no paper, no greys). */
const SPICE_COLORS = [0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 21];
/** Fälscher: each player's own colour, in table order. */
export const FORGER_COLORS = [4, 11, 8, 13, 5, 9, 14, 16, 0, 22];
const VOTE_MS = 30_000;
const UNMASK_MS = 20_000;
const FORGER_REVEAL_MS = 8_000;
/** Fälscher's points. */
export const FORGER_POINTS = Object.freeze({ escaped: 800, guessed: 500, artists: 300, vote: 100 });
/** A stroke player gone this long is skipped. */
const STROKE_GRACE = 5_000;
/** Stille Post: seconds to write or describe (drawing takes the draw time), and the longest chain. */
const TELL_MS = 45_000;
export const TELEPHONE_MAX_STEPS = 8;
const TELL_LENGTH = 80;

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
  /** Gone for a while (not just reconnecting). */
  const goneFor = (p, ms) => !isOnline(p) && p.offlineSince !== null && clock.now() - p.offlineSince >= ms;

  function shuffled(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

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
      team: null,
      joined: clock.now(),
      online: 0,
      offlineSince: clock.now(),
      left: false,
      chats: [],
      reacted: 0,
      close: 0,
    };
    r.players.set(p.id, p);
    if (usesTeams(r)) p.team = smallestTeam(r);
    // Someone arriving mid-game draws later this round.
    if (r.game && r.phase !== 'final') r.game.queue.push(p.id);
    return p;
  }

  // ---- teams (Team duel) --------------------------------------------------------------------

  const usesTeams = (r) => (r.game ? r.game.mode : r.settings.mode) === 'duel';
  const teamCount = (r) => (r.game?.mode === 'duel' ? r.game.teams : r.settings.teams);

  function smallestTeam(r) {
    const sizes = Array(teamCount(r)).fill(0);
    for (const p of present(r)) if (p.team !== null && p.team < sizes.length) sizes[p.team]++;
    return sizes.indexOf(Math.min(...sizes));
  }

  /** Everyone into teams again, in turn (shuffled first if asked). */
  function spreadTeams(r, mix = false) {
    const people = mix ? shuffled(present(r)) : present(r);
    const teams = r.settings.mode === 'duel' ? r.settings.teams : 0;
    people.forEach((p, i) => (p.team = teams ? i % teams : null));
  }

  /** The members of each team, as ids, in join order. */
  function teamLists(r) {
    const lists = Array.from({ length: teamCount(r) }, () => []);
    for (const p of present(r)) if (p.team !== null && p.team < lists.length) lists[p.team].push(p.id);
    return lists;
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

  /** Does this player know the word right now? */
  function knows(t, p) {
    if (!t || !p || t.kind === 'telephone') return false;
    if (t.kind === 'classic') return t.drawer === p.id || t.guessed.has(p.id);
    if (t.kind === 'duel') {
      const team = t.teams.find((x) => x.team === p.team);
      return Boolean(team && (team.drawer === p.id || team.done));
    }
    return p.id !== t.forger;
  }

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
        team: p.team,
        guessed: Boolean(
          t &&
            (t.kind === 'telephone'
              ? t.phase === 'tell' && t.done.has(p.id)
              : t.kind === 'forger'
                ? t.phase === 'vote' && t.votes.has(p.id)
                : t.phase !== 'choose' && knows(t, p) && !isDrawer(t, p.id)),
        ),
        points: t?.phase === 'reveal' ? (t.points.get(p.id) ?? 0) : null,
      })),
      game: r.game ? { mode: r.game.mode, rounds: r.game.rounds, round: r.game.round, teams: r.game.teams ?? 0 } : null,
      teams: r.game?.mode === 'duel' ? r.teamScores : null,
      turn: t ? turnView(r, t, me) : null,
      final: r.phase === 'final' ? finalView(r) : null,
      reactions: REACTIONS,
      now: clock.now(),
    };
  }

  function isDrawer(t, id) {
    if (t.kind === 'classic') return t.drawer === id;
    if (t.kind === 'duel') return t.teams.some((x) => x.drawer === id);
    return false;
  }

  function likeCounts(t, me) {
    let likes = 0;
    let dislikes = 0;
    for (const v of t.likes.values()) v > 0 ? likes++ : dislikes++;
    return { like: me ? (t.likes.get(me.id) ?? 0) : 0, likes, dislikes };
  }

  function turnView(r, t, me) {
    if (t.kind === 'forger') return forgerView(r, t, me);
    if (t.kind === 'telephone') return telephoneView(r, t, me);
    const base = { kind: t.kind, n: t.n, round: t.round, drawer: t.drawer ?? null, phase: t.phase };
    if (t.phase === 'choose') {
      return {
        ...base,
        endsAt: t.chooseEndsAt,
        choices: me?.id === t.drawer ? t.choices.map((c) => ({ word: c.word, difficulty: c.difficulty })) : null,
      };
    }
    const word = t.phase === 'reveal' || knows(t, me) ? t.entry.word : null;
    const hidden = !word && r.settings.wordMode === 'hidden' && t.shown === 0;
    const myTeam = t.kind === 'duel' && me ? me.team : null;
    return {
      ...base,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      difficulty: t.entry.difficulty,
      word,
      pattern: word || hidden ? null : pattern(t.entry.word, t.revealed),
      hints: t.shown,
      hintsTotal: t.hints.length,
      guessed: t.kind === 'duel' ? t.teams.filter((x) => x.done).length : t.guessed.size,
      spice: t.spice,
      palette: t.palette,
      ...likeCounts(t, me),
      ended: t.ended,
      revealEndsAt: t.revealEndsAt ?? null,
      myTeam,
      teams:
        t.kind === 'duel'
          ? t.teams.map((x) => ({ team: x.team, drawer: x.drawer, done: x.done, order: x.order, at: x.at, points: t.phase === 'reveal' ? x.points : null }))
          : null,
    };
  }

  function forgerView(r, t, me) {
    const revealed = t.phase === 'reveal';
    const tally = {};
    for (const target of t.votes.values()) tally[target] = (tally[target] ?? 0) + 1;
    return {
      kind: 'forger',
      n: t.n,
      round: t.round,
      phase: t.phase,
      drawer: null,
      category: t.category,
      word: revealed || (me && me.id !== t.forger) ? t.entry.word : null,
      difficulty: t.entry.difficulty,
      forgerMe: me?.id === t.forger,
      forger: revealed ? t.forger : null,
      order: t.order,
      laps: t.laps,
      step: t.step,
      colors: Object.fromEntries(t.colors),
      stroke: t.phase === 'forge' && t.stroke ? { player: t.stroke.player, endsAt: t.stroke.endsAt, started: t.stroke.started } : null,
      endsAt: t.phase === 'vote' || t.phase === 'unmask' ? t.endsAt : null,
      voted: t.phase === 'vote' ? [...t.votes.keys()] : null,
      myVote: me ? (t.votes.get(me.id) ?? null) : null,
      tally: t.phase === 'unmask' || revealed ? tally : null,
      caught: t.phase === 'unmask' || revealed ? t.caught : null,
      forgerGuess: revealed ? t.forgerGuess : null,
      forgerRight: revealed ? t.forgerRight : null,
      ended: t.ended,
      revealEndsAt: t.revealEndsAt ?? null,
      ...likeCounts(t, me),
    };
  }

  function finalView(r) {
    return {
      awards: r.awards,
      drawings: r.gallery.map((g) => ({
        n: g.n,
        round: g.round,
        drawer: g.drawer,
        word: g.word,
        difficulty: g.difficulty,
        likes: g.likes,
        dislikes: g.dislikes,
        guessed: g.guessed,
        possible: g.possible,
        kind: g.kind,
        team: g.team ?? null,
      })),
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
   * words), guessed (got it), team (a team got it: text is the team), close and half (only to the
   * guesser), join, leave, word (the turn's word at its end), skip (the turn was skipped), host.
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

  /** Whoever knows the word right now (classic): the drawer and those who've guessed it. */
  function knowers(t) {
    return new Set([t.drawer, ...t.guessed.keys()]);
  }

  function teamMembers(r, team) {
    return new Set(present(r).filter((p) => p.team === team).map((p) => p.id));
  }

  function say(r, p, raw) {
    const text = cleanText(raw, LIMITS.message);
    if (!text) throw new GameError('empty');
    if (!p.bot && !within(p.chats, CHAT_WINDOW, CHAT_MAX)) throw new GameError('slow-down', 429);
    const t = r.turn;
    if (t && t.kind === 'classic' && r.phase === 'draw') return sayClassic(r, t, p, text);
    if (t && t.kind === 'duel' && r.phase === 'draw') return sayDuel(r, t, p, text);
    if (t && t.kind === 'forger' && ['forge', 'vote', 'unmask'].includes(r.phase)) {
      // Those who know the word can't write it, or anything close: the forger reads the chat too.
      if (p.id !== t.forger && judge(t.entry, text)) throw new GameError('spoiler', 409);
      post(r, 'msg', p.id, text);
      return;
    }
    post(r, 'msg', p.id, text);
  }

  function sayClassic(r, t, p, text) {
    const knowsIt = t.drawer === p.id || t.guessed.has(p.id);
    const result = judge(t.entry, text);
    if (knowsIt) {
      // The drawer, or someone who has it, can't hand the word out.
      if (result) throw new GameError('spoiler', 409);
      post(r, 'msg', p.id, text, knowers(t));
      return;
    }
    if (result === 'right') return guessed(r, p);
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
  }

  function sayDuel(r, t, p, text) {
    // A team's chat stays in the team while it draws: the others mustn't overhear the guesses.
    const members = teamMembers(r, p.team);
    members.add(p.id);
    const team = t.teams.find((x) => x.team === p.team);
    const knowsIt = Boolean(team && (team.drawer === p.id || team.done));
    const result = judge(t.entry, text);
    if (knowsIt) {
      if (result) throw new GameError('spoiler', 409);
      post(r, 'msg', p.id, text, members);
      return;
    }
    if (result === 'right' && team) return teamGuessed(r, p, team);
    post(r, 'msg', p.id, text, members);
    if (result === 'close' || result === 'half') {
      p.close++;
      if (r.settings.nearMiss) post(r, result, p.id, text, new Set([p.id]));
    }
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

  // ---- the game -----------------------------------------------------------------------------

  function startGame(r) {
    const people = present(r);
    const mode = r.settings.mode;
    if (mode === 'telephone' && people.length < 3) throw new GameError('too-few-three', 409);
    if (people.length < (mode === 'forger' ? 3 : 2)) throw new GameError(mode === 'forger' ? 'too-few-forger' : 'too-few', 409);
    const words = pool(r.settings);
    if (r.settings.onlyCustom && words.length < CUSTOM_LIMITS.min) throw new GameError('custom-few', 409);
    if (words.length < (r.settings.wordMode === 'combo' && mode !== 'forger' ? 2 : 1)) throw new GameError('no-words', 409);
    if (mode === 'duel') {
      for (const p of people) if (p.team === null || p.team >= r.settings.teams) p.team = smallestTeam(r);
      if (teamLists(r).filter((m) => m.length).length < 2) throw new GameError('teams', 409);
    } else for (const p of people) p.team = null;
    clearTimers(r);
    r.game = {
      mode,
      rounds: r.settings.rounds,
      round: 0,
      queue: [],
      seen: new Set(),
      words,
      n: 0,
      teams: mode === 'duel' ? r.settings.teams : 0,
      turnInRound: 0,
      forgers: new Set(),
    };
    r.gallery = [];
    r.awards = null;
    r.notice = null;
    r.teamScores = mode === 'duel' ? Array(r.settings.teams).fill(0) : [];
    for (const p of r.players.values()) {
      p.score = 0;
      p.close = 0;
    }
    nextRound(r);
  }

  function nextRound(r) {
    r.game.round++;
    if (r.game.round > r.game.rounds) return finish(r);
    if (r.game.mode === 'forger') return forgerRound(r);
    if (r.game.mode === 'telephone') return r.game.round === 1 ? telephoneStart(r) : finish(r);
    if (r.game.mode === 'duel') {
      r.game.turnInRound = 0;
      return duelTurn(r);
    }
    r.game.queue = present(r).map((p) => p.id);
    nextTurn(r);
  }

  /** After a turn's reveal: the next one, whatever the mode. */
  function afterReveal(r) {
    if (r.game.mode === 'forger') return nextRound(r);
    if (r.game.mode === 'duel') return duelTurn(r);
    return nextTurn(r);
  }

  /** Würze for a turn: none, the host's pick, or a random one. */
  function pickSpice(r) {
    const s = r.settings.spice;
    if (s === 'off') return { spice: null, palette: null };
    const spice = s === 'random' ? SPICES[randomInt(SPICES.length)] : s;
    if (spice !== 'three') return { spice, palette: null };
    const colors = [...SPICE_COLORS];
    const palette = [];
    while (palette.length < 3) palette.push(colors.splice(randomInt(colors.length), 1)[0]);
    return { spice, palette };
  }

  /** What the server holds Würze to: one stroke, the ink budget, the three colours. */
  function spiceFilter(t, drawing, ops) {
    if (!t.spice || !Array.isArray(ops)) return ops;
    let budget = INK_BUDGET - drawing.points;
    let strokes = drawing.actions.filter((a) => a.k === 's').length;
    const out = [];
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      if (t.spice === 'oneline' && op[0] === 's') {
        if (strokes >= 1) continue;
        strokes++;
      }
      if (t.spice === 'oneline' && (op[0] === 'f' || op[0] === 'x')) continue;
      if (t.spice === 'ink' && op[0] === 's') {
        if (budget <= 0) continue;
        budget--;
      }
      if (t.spice === 'ink' && op[0] === 'p') {
        const n = Math.min(Math.floor((op.length - 2) / 3), Math.max(0, budget));
        if (!n) continue;
        budget -= n;
        out.push(op.slice(0, 2 + n * 3));
        continue;
      }
      if (t.spice === 'three' && op[0] === 's' && op[2] !== PAPER && !t.palette.includes(op[2])) continue;
      if (t.spice === 'three' && op[0] === 'f' && !t.palette.includes(op[1])) continue;
      out.push(op);
    }
    return out;
  }

  // ---- classic and blitz --------------------------------------------------------------------

  function nextTurn(r) {
    clearTimers(r);
    const game = r.game;
    let drawer = null;
    while (game.queue.length && !drawer) {
      const p = r.players.get(game.queue.shift());
      // Someone whose page is only reconnecting keeps the turn; gone for a while, they're skipped.
      if (p && !p.left && !goneFor(p, DRAWER_GRACE)) drawer = p;
    }
    if (!drawer) return nextRound(r);
    if (present(r).length < 2) return finish(r);
    const options = drawChoices(game.words, r.settings.words, game.seen, r.settings.wordMode === 'combo', randomInt);
    if (!options.length) return finish(r);
    const now = clock.now();
    r.turn = {
      kind: 'classic',
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
      spice: null,
      palette: null,
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
    Object.assign(t, pickSpice(r));
    startDrawing(r, t);
    playBots(r, t);
    touch(r);
    sendCanvas(r);
  }

  /** The draw phase's clock and hints, for classic and duel turns. */
  function startDrawing(r, t) {
    const now = clock.now();
    const total = r.settings.seconds * 1000;
    t.phase = 'draw';
    t.startsAt = now;
    t.endsAt = now + total;
    t.hints = hintOrder(t.entry.word, r.settings.hints, random);
    t.hintAt = hintTimes(t.hints.length, total, r.game.mode === 'blitz');
    r.phase = 'draw';
    later(r, total, () => (t.kind === 'duel' ? endDuel(r, 'time') : endTurn(r, 'time')));
    t.hintAt.forEach((at, i) =>
      later(r, at, () => {
        if (r.turn !== t || t.phase !== 'draw') return;
        t.shown = i + 1;
        t.revealed.add(t.hints[i]);
        touch(r);
      }),
    );
  }

  /** Everyone who could guess has it: end after a beat. */
  function maybeEnd(r) {
    const t = r.turn;
    if (r.phase !== 'draw' || !t || t.ending) return;
    if (t.kind === 'duel') {
      if (t.teams.every((x) => x.done)) {
        t.ending = true;
        later(r, EARLY_END_MS, () => endDuel(r, 'all'));
      }
      return;
    }
    if (t.kind !== 'classic') return;
    const guessers = present(r).filter((p) => p.id !== t.drawer && isOnline(p));
    if (!guessers.length || guessers.some((p) => !t.guessed.has(p.id))) return;
    t.ending = true;
    later(r, EARLY_END_MS, () => endTurn(r, 'all'));
  }

  /** @param {'time' | 'all' | 'skip' | 'drawer-gone'} reason */
  function endTurn(r, reason) {
    const t = r.turn;
    if (!t || t.kind !== 'classic' || (t.phase !== 'draw' && t.phase !== 'choose')) return;
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
      kind: 'classic',
      n: t.n,
      round: t.round,
      drawer: t.drawer,
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
      if (r.phase === 'reveal') afterReveal(r);
    });
    touch(r);
  }

  // ---- team duel ----------------------------------------------------------------------------

  function duelTurn(r) {
    clearTimers(r);
    const g = r.game;
    const lists = teamLists(r);
    const filled = lists.filter((m) => m.length);
    if (filled.length < 2 || present(r).length < 2) return finish(r);
    const size = Math.max(...filled.map((m) => m.length));
    if (g.turnInRound >= size) return nextRound(r);
    const index = g.turnInRound++;
    const [entry] = drawChoices(g.words, 1, g.seen, r.settings.wordMode === 'combo', randomInt);
    if (!entry) return finish(r);
    for (const e of entry.parts ?? [entry]) g.seen.add(e.word);
    const t = {
      kind: 'duel',
      n: ++g.n,
      round: g.round,
      drawer: null,
      phase: 'draw',
      entry,
      startsAt: 0,
      endsAt: 0,
      hints: [],
      hintAt: [],
      shown: 0,
      revealed: new Set(),
      teams: lists
        .map((members, team) => (members.length ? { team, drawer: members[index % members.length], drawing: newDrawing(), done: false, order: null, at: null, guesser: null, points: 0 } : null))
        .filter(Boolean),
      points: new Map(),
      likes: new Map(),
      ended: null,
      ending: false,
      ...pickSpice(r),
    };
    r.turn = t;
    startDrawing(r, t);
    playDuelBots(r, t);
    touch(r);
    sendCanvas(r);
  }

  function teamGuessed(r, p, team) {
    const t = r.turn;
    const now = clock.now();
    const order = t.teams.filter((x) => x.done).length;
    team.done = true;
    team.order = order;
    team.at = now - t.startsAt;
    team.guesser = p.id;
    team.points = guessPoints({ left: t.endsAt - now, total: t.endsAt - t.startsAt, order, difficulty: t.entry.difficulty });
    post(r, 'team', p.id, String(team.team));
    touch(r);
    maybeEnd(r);
  }

  /** @param {'time' | 'all' | 'skip'} reason */
  function endDuel(r, reason) {
    const t = r.turn;
    if (!t || t.kind !== 'duel' || t.phase !== 'draw') return;
    clearTimers(r);
    for (const team of t.teams) {
      if (!team.done) continue;
      // The guesser and the team's drawer both get the team's points.
      for (const id of new Set([team.guesser, team.drawer])) {
        const p = r.players.get(id);
        if (p) p.score += team.points;
        t.points.set(id, (t.points.get(id) ?? 0) + team.points);
      }
      r.teamScores[team.team] += team.points;
    }
    t.phase = 'reveal';
    t.ended = reason;
    t.revealEndsAt = clock.now() + REVEAL_MS;
    r.phase = 'reveal';
    for (const team of t.teams) {
      r.gallery.push({
        kind: 'duel',
        n: t.n * 10 + team.team,
        round: t.round,
        drawer: team.drawer,
        team: team.team,
        word: t.entry.word,
        difficulty: t.entry.difficulty,
        drawing: team.drawing,
        turn: t,
        likes: 0,
        dislikes: 0,
        guessed: team.done ? 1 : 0,
        possible: 1,
        first: team.done ? { player: team.guesser, ms: team.at } : null,
      });
    }
    post(r, reason === 'skip' ? 'skip' : 'word', t.teams[0]?.drawer ?? '', t.entry.word);
    later(r, REVEAL_MS, () => {
      if (r.phase === 'reveal') afterReveal(r);
    });
    touch(r);
    // Now everyone may see every team's drawing.
    sendCanvas(r);
  }

  // ---- Fälscher -----------------------------------------------------------------------------

  function forgerRound(r) {
    clearTimers(r);
    const g = r.game;
    const people = present(r);
    if (people.length < 3) return finish(r);
    let candidates = people.filter((p) => !g.forgers.has(p.id) && !goneFor(p, DRAWER_GRACE));
    if (!candidates.length) {
      g.forgers.clear();
      candidates = people.filter((p) => !goneFor(p, DRAWER_GRACE));
    }
    const forger = candidates[randomInt(candidates.length)] ?? people[0];
    g.forgers.add(forger.id);
    const [entry] = drawChoices(g.words, 1, g.seen, false, randomInt);
    if (!entry) return finish(r);
    g.seen.add(entry.word);
    const order = shuffled(people.map((p) => p.id));
    // The forger never opens: the first stroke shows the word to everyone who knows it.
    if (order[0] === forger.id) [order[0], order[1]] = [order[1], order[0]];
    const now = clock.now();
    const t = {
      kind: 'forger',
      n: ++g.n,
      round: g.round,
      phase: 'forge',
      entry,
      category: entry.pack,
      forger: forger.id,
      order,
      laps: r.settings.laps,
      step: -1,
      stroke: null,
      colors: new Map(order.map((id, i) => [id, FORGER_COLORS[i % FORGER_COLORS.length]])),
      drawing: newDrawing(),
      votes: new Map(),
      caught: null,
      forgerGuess: null,
      forgerRight: null,
      points: new Map(),
      likes: new Map(),
      startsAt: now,
      endsAt: 0,
      ended: null,
    };
    r.turn = t;
    r.phase = 'forge';
    sendCanvas(r);
    nextStroke(r);
  }

  function nextStroke(r) {
    const t = r.turn;
    if (!t || t.kind !== 'forger' || t.phase !== 'forge') return;
    clearTimers(r);
    const total = t.order.length * t.laps;
    let p = null;
    while (!p) {
      t.step++;
      if (t.step >= total) return startVote(r);
      const candidate = r.players.get(t.order[t.step % t.order.length]);
      if (candidate && !candidate.left && !goneFor(candidate, STROKE_GRACE)) p = candidate;
    }
    const ms = r.settings.strokeSeconds * 1000;
    t.stroke = { player: p.id, endsAt: clock.now() + ms, started: false, id: null };
    later(r, ms, () => nextStroke(r));
    if (p.bot) {
      later(r, 700 + randomInt(900), () => {
        if (r.turn !== t || t.stroke?.player !== p.id) return;
        const ops = squiggle(t, 2000 + t.step, t.colors.get(p.id), 1);
        t.stroke.started = true;
        sendInk(r, t.n, applyOps(t.drawing, ops), { except: p.id });
        later(r, 500, () => t.stroke?.player === p.id && nextStroke(r));
      });
    }
    touch(r);
  }

  function startVote(r) {
    const t = r.turn;
    clearTimers(r);
    t.phase = 'vote';
    t.stroke = null;
    t.endsAt = clock.now() + VOTE_MS;
    r.phase = 'vote';
    later(r, VOTE_MS, () => endVote(r));
    for (const p of present(r)) {
      if (!p.bot) continue;
      later(r, 1000 + randomInt(5000), () => {
        if (r.turn !== t || t.phase !== 'vote') return;
        const others = present(r).filter((q) => q.id !== p.id);
        // An artist bot sees through the forger half the time.
        const target = p.id !== t.forger && random() < 0.5 ? t.forger : others[randomInt(others.length)]?.id;
        if (target) vote(r, p, target);
      });
    }
    touch(r);
  }

  function vote(r, p, target) {
    const t = r.turn;
    const q = r.players.get(String(target ?? ''));
    if (!q || q.left || q.id === p.id) throw new GameError('vote');
    t.votes.set(p.id, q.id);
    touch(r);
    const waiting = present(r).filter((x) => isOnline(x) && !t.votes.has(x.id));
    if (!waiting.length && !t.ending) {
      t.ending = true;
      later(r, 800, () => endVote(r));
    }
  }

  function endVote(r) {
    const t = r.turn;
    if (!t || t.kind !== 'forger' || t.phase !== 'vote') return;
    clearTimers(r);
    t.ending = false;
    const tally = new Map();
    for (const target of t.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
    const top = Math.max(0, ...tally.values());
    const leaders = [...tally.entries()].filter(([, n]) => n === top && n > 0).map(([id]) => id);
    // A tie lets the forger slip away.
    t.caught = leaders.length === 1 && leaders[0] === t.forger;
    if (!t.caught) return forgerReveal(r, 'escaped');
    t.phase = 'unmask';
    t.endsAt = clock.now() + UNMASK_MS;
    r.phase = 'unmask';
    later(r, UNMASK_MS, () => forgerReveal(r, 'caught'));
    const forger = r.players.get(t.forger);
    if (forger?.bot) {
      later(r, 2500, () => {
        if (r.turn !== t || t.phase !== 'unmask') return;
        unmask(r, forger, random() < 0.4 ? t.entry.word : BOT_MISSES[randomInt(BOT_MISSES.length)]);
      });
    }
    touch(r);
  }

  function unmask(r, p, raw) {
    const t = r.turn;
    if (p.id !== t.forger) throw new GameError('not-forger', 403);
    const text = cleanText(raw, LIMITS.message);
    if (!text) throw new GameError('empty');
    t.forgerGuess = text;
    t.forgerRight = judge(t.entry, text) === 'right';
    forgerReveal(r, t.forgerRight ? 'guessed' : 'caught');
  }

  /** @param {'escaped' | 'caught' | 'guessed' | 'forger-gone' | 'skip'} reason */
  function forgerReveal(r, reason) {
    const t = r.turn;
    if (!t || t.kind !== 'forger' || t.phase === 'reveal') return;
    clearTimers(r);
    const give = (id, points) => {
      const p = r.players.get(id);
      if (p) p.score += points;
      t.points.set(id, (t.points.get(id) ?? 0) + points);
    };
    if (reason === 'escaped') give(t.forger, FORGER_POINTS.escaped);
    else if (reason === 'guessed') give(t.forger, FORGER_POINTS.guessed);
    else if (reason === 'caught') {
      for (const id of t.order) {
        if (id === t.forger) continue;
        give(id, FORGER_POINTS.artists + (t.votes.get(id) === t.forger ? FORGER_POINTS.vote : 0));
      }
    }
    t.phase = 'reveal';
    t.ended = reason;
    t.stroke = null;
    t.revealEndsAt = clock.now() + FORGER_REVEAL_MS;
    r.phase = 'reveal';
    r.gallery.push({
      kind: 'forger',
      n: t.n,
      round: t.round,
      drawer: t.forger,
      word: t.entry.word,
      difficulty: t.entry.difficulty,
      drawing: t.drawing,
      turn: t,
      likes: 0,
      dislikes: 0,
      guessed: t.caught ? 1 : 0,
      possible: 1,
      first: null,
    });
    post(r, 'word', t.forger, t.entry.word);
    later(r, FORGER_REVEAL_MS, () => {
      if (r.phase === 'reveal') afterReveal(r);
    });
    touch(r);
  }


  // ---- Stille Post --------------------------------------------------------------------------

  /** Step 0 writes; then drawing and describing take turns. */
  const stepKind = (step) => (step === 0 ? 'write' : step % 2 === 1 ? 'draw' : 'describe');

  function telephoneStart(r) {
    clearTimers(r);
    const g = r.game;
    const order = present(r).map((p) => p.id);
    g.chains = order.map((owner) => ({ owner, entries: [] }));
    const t = {
      kind: 'telephone',
      n: ++g.n,
      round: 1,
      phase: 'tell',
      order,
      step: -1,
      steps: Math.min(order.length, TELEPHONE_MAX_STEPS),
      stepKind: 'write',
      startsAt: 0,
      endsAt: 0,
      done: new Set(),
      texts: new Map(),
      drawings: new Map(),
      suggestions: new Map(),
      show: null,
      points: new Map(),
      likes: new Map(),
      ended: null,
    };
    r.turn = t;
    nextStep(r);
  }

  /** The chain a player works on in a step: never their own until it comes round again. */
  const chainOf = (t, playerId, step = t.step) => (t.order.indexOf(playerId) + step) % t.order.length;

  function nextStep(r) {
    const t = r.turn;
    clearTimers(r);
    t.step++;
    if (t.step >= t.steps) return startShowcase(r);
    if (t.step > 0) t.n = ++r.game.n;
    t.stepKind = stepKind(t.step);
    t.done = new Set();
    t.texts = new Map();
    t.drawings = new Map();
    const now = clock.now();
    const ms = t.stepKind === 'draw' ? r.settings.seconds * 1000 : TELL_MS;
    t.startsAt = now;
    t.endsAt = now + ms;
    r.phase = 'tell';
    if (t.stepKind === 'write') {
      for (const id of t.order) {
        const [e] = drawChoices(r.game.words, 1, r.game.seen, false, randomInt);
        if (e) t.suggestions.set(id, e.word);
      }
    }
    later(r, ms, () => endStep(r));
    playTelephoneBots(r, t);
    touch(r);
    sendCanvas(r);
  }

  /** Everyone's part of this step goes into their chain; whatever's missing gets a stand-in. */
  function endStep(r) {
    const t = r.turn;
    if (!t || t.kind !== 'telephone' || t.phase !== 'tell') return;
    clearTimers(r);
    for (const id of t.order) {
      const chain = r.game.chains[chainOf(t, id)];
      if (t.stepKind === 'draw') chain.entries.push({ player: id, kind: 'drawing', drawing: t.drawings.get(id) ?? newDrawing() });
      else chain.entries.push({ player: id, kind: 'text', text: t.texts.get(id) ?? (t.stepKind === 'write' ? (t.suggestions.get(id) ?? '…') : '…') });
    }
    nextStep(r);
  }

  function maybeEndStep(r) {
    const t = r.turn;
    const waiting = t.order.filter((id) => {
      const p = r.players.get(id);
      return p && !p.left && isOnline(p) && !t.done.has(id);
    });
    if (!waiting.length && !t.ending) {
      t.ending = true;
      later(r, 600, () => {
        t.ending = false;
        endStep(r);
      });
    }
  }

  function tell(r, p, raw) {
    const t = r.turn;
    if (t.stepKind === 'draw') throw new GameError('wrong-phase', 409);
    if (!t.order.includes(p.id)) throw new GameError('no-player', 403);
    const text = cleanText(raw, TELL_LENGTH);
    if (!text) throw new GameError('empty');
    t.texts.set(p.id, text);
    t.done.add(p.id);
    touch(r);
    maybeEndStep(r);
  }

  function startShowcase(r) {
    const t = r.turn;
    t.phase = 'showcase';
    t.show = { chain: 0, entry: 0 };
    r.phase = 'showcase';
    // Every drawing joins the gallery, with the words it was drawn from.
    r.game.chains.forEach((chain, c) =>
      chain.entries.forEach((e, i) => {
        if (e.kind !== 'drawing') return;
        r.gallery.push({
          kind: 'telephone',
          n: c * 100 + i,
          round: 1,
          drawer: e.player,
          word: chain.entries[i - 1]?.text ?? '',
          difficulty: 'medium',
          drawing: e.drawing,
          turn: t,
          likes: 0,
          dislikes: 0,
          guessed: null,
          possible: null,
          first: null,
        });
      }),
    );
    touch(r);
  }

  /** The host steps through the chains, entry by entry; past the last one, the game ends. */
  function showStep(r, delta) {
    const t = r.turn;
    const chains = r.game.chains;
    let { chain, entry } = t.show;
    entry += delta;
    if (entry >= chains[chain].entries.length) {
      chain++;
      entry = 0;
    } else if (entry < 0) {
      chain = Math.max(0, chain - 1);
      entry = chain === t.show.chain ? 0 : chains[chain].entries.length - 1;
    }
    if (chain >= chains.length) return finish(r);
    t.show = { chain, entry };
    touch(r);
  }

  function telephoneView(r, t, me) {
    const mine = me && t.order.includes(me.id) ? me.id : null;
    let prompt = null;
    if (t.phase === 'tell' && mine && t.stepKind === 'draw') {
      const prev = r.game.chains[chainOf(t, mine)].entries[t.step - 1];
      prompt = prev?.text ?? '…';
    }
    const show = t.show
      ? {
          chain: t.show.chain,
          entry: t.show.entry,
          owner: r.game.chains[t.show.chain].owner,
          chains: r.game.chains.length,
          length: r.game.chains[t.show.chain].entries.length,
        }
      : null;
    return {
      kind: 'telephone',
      n: t.n,
      round: 1,
      drawer: null,
      phase: t.phase,
      step: t.step,
      steps: t.steps,
      stepKind: t.stepKind,
      startsAt: t.startsAt,
      endsAt: t.endsAt,
      done: [...t.done],
      myDone: mine ? t.done.has(mine) : false,
      myText: mine ? (t.texts.get(mine) ?? null) : null,
      prompt,
      promptDrawing: t.phase === 'tell' && t.stepKind === 'describe' && Boolean(mine),
      suggestion: t.phase === 'tell' && t.stepKind === 'write' && mine ? (t.suggestions.get(mine) ?? null) : null,
      show,
      ...likeCounts(t, me),
      ended: null,
    };
  }

  function playTelephoneBots(r, t) {
    const ms = t.endsAt - t.startsAt;
    for (const id of t.order) {
      const p = r.players.get(id);
      if (!p?.bot) continue;
      later(r, Math.min(ms - 1000, 2000 + randomInt(4000)), () => {
        if (r.turn !== t || t.phase !== 'tell' || t.done.has(id)) return;
        if (t.stepKind === 'draw') {
          const d = newDrawing();
          for (let k = 0; k < 4; k++) applyOps(d, squiggle(t, 3000 + k));
          t.drawings.set(id, d);
          t.done.add(id);
          touch(r);
          maybeEndStep(r);
        } else {
          const [e] = drawChoices(r.game.words, 1, new Set(), false, randomInt);
          tell(r, p, e ? e.word : BOT_MISSES[randomInt(BOT_MISSES.length)]);
        }
      });
    }
  }

  // ---- the end ------------------------------------------------------------------------------

  function finish(r) {
    clearTimers(r);
    r.phase = 'final';
    r.turn = null;
    if (r.game) r.game.queue = [];
    for (const g of r.gallery) {
      g.likes = 0;
      g.dislikes = 0;
      const likes = g.turn.likes;
      for (const v of likes.values()) v > 0 ? g.likes++ : g.dislikes++;
    }
    r.awards = awards(r);
    touch(r);
  }

  function awards(r) {
    const out = {};
    const liked = [...r.gallery].filter((g) => g.likes > 0).sort((a, b) => b.likes - b.dislikes - (a.likes - a.dislikes) || a.n - b.n)[0];
    if (liked) out.liked = { n: liked.n, drawer: liked.drawer, word: liked.word, likes: liked.likes };
    const guessable = r.gallery.filter((g) => g.kind !== 'forger');
    const fastest = guessable.filter((g) => g.first).sort((a, b) => a.first.ms - b.first.ms)[0];
    if (fastest) out.fastest = { player: fastest.first.player, ms: fastest.first.ms, word: fastest.word };
    const close = present(r).filter((p) => p.close > 0).sort((a, b) => b.close - a.close)[0];
    if (close) out.close = { player: close.id, count: close.close };
    const unsolved = guessable.find((g) => g.guessed === 0);
    if (unsolved) out.unsolved = { n: unsolved.n, drawer: unsolved.drawer, word: unsolved.word };
    const escaped = r.gallery.filter((g) => g.kind === 'forger' && g.turn.ended === 'escaped');
    if (escaped.length) {
      const counts = new Map();
      for (const g of escaped) counts.set(g.drawer, (counts.get(g.drawer) ?? 0) + 1);
      const [player, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      out.forger = { player, count };
    }
    return out;
  }

  // ---- ink ----------------------------------------------------------------------------------

  /**
   * Ink to the pages that may see it: everyone but the one drawing, or (a duel's team canvas) only
   * the team and the big screen.
   */
  function sendInk(r, n, ops, { except = null, team = null } = {}) {
    if (!ops.length) return;
    const data = JSON.stringify({ turn: n, team, ops });
    const members = team === null ? null : teamMembers(r, team);
    for (const s of r.subscribers) {
      if (s.player === except) continue;
      if (members && s.player !== null && !members.has(s.player)) continue;
      s.send('ink', data);
    }
  }

  /** The canvases one page may see: the whole drawing so far (a duel: its team's, all at the end). */
  function canvasesFor(r, playerId) {
    const t = r.turn;
    if (!t || t.phase === 'choose') return [];
    if (t.kind === 'telephone') {
      // Only your own drawing of this step, coming back to it; nobody watches anyone else draw.
      const own = playerId && t.phase === 'tell' && t.stepKind === 'draw' ? t.drawings.get(playerId) : null;
      return own ? [{ turn: t.n, team: null, ops: toOps(own) }] : [];
    }
    if (t.kind !== 'duel') return [{ turn: t.n, team: null, ops: toOps(t.drawing) }];
    const p = playerId ? r.players.get(playerId) : null;
    return t.teams
      .filter((x) => t.phase === 'reveal' || !p || x.team === p.team)
      .map((x) => ({ turn: t.n, team: x.team, ops: toOps(x.drawing) }));
  }

  function sendCanvas(r) {
    for (const s of r.subscribers) for (const c of canvasesFor(r, s.player)) s.send('canvas', JSON.stringify(c));
  }

  // ---- bots ---------------------------------------------------------------------------------

  /** Bots try the game out: random squiggles when they draw, the odd miss and a likely right guess. */
  function playBots(r, t) {
    const total = t.endsAt - t.startsAt;
    const drawer = r.players.get(t.drawer);
    if (drawer?.bot) {
      for (let k = 0; k < (t.spice === 'oneline' ? 1 : 9); k++) {
        later(r, 500 + k * Math.min(1100, total / 12), () => {
          if (r.turn !== t || t.phase !== 'draw') return;
          sendInk(r, t.n, applyOps(t.drawing, spiceFilter(t, t.drawing, squiggle(t, 1000 + k, t.palette?.[0]))), { except: drawer.id });
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

  function playDuelBots(r, t) {
    const total = t.endsAt - t.startsAt;
    for (const team of t.teams) {
      const drawer = r.players.get(team.drawer);
      if (drawer?.bot) {
        for (let k = 0; k < 6; k++) {
          later(r, 500 + k * Math.min(1300, total / 10), () => {
            if (r.turn !== t || t.phase !== 'draw') return;
            sendInk(r, t.n, applyOps(team.drawing, spiceFilter(t, team.drawing, squiggle(t, 1000 + k, t.palette?.[0]))), { except: drawer.id, team: team.team });
          });
        }
      }
      const guessers = present(r).filter((p) => p.bot && p.team === team.team && p.id !== team.drawer);
      for (const p of guessers) {
        if (random() < 0.6) {
          later(r, total * (0.2 + random() * 0.6), () => {
            if (r.turn === t && t.phase === 'draw' && !team.done) teamGuessed(r, p, team);
          });
        }
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

  function squiggle(t, id, color = randomInt(PALETTE_SIZE), size = randomInt(3)) {
    const at = () => clock.now() - t.startsAt;
    let x = 120 + randomInt(W - 240);
    let y = 100 + randomInt(H - 200);
    const c = color === PAPER ? 0 : color;
    const ops = [['s', id, c, size, x, y, at()]];
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
    const t = r.turn;
    if (r.game && r.phase !== 'final' && present(r).length < (r.game.mode === 'forger' || r.game.mode === 'telephone' ? 3 : 2)) return finish(r);
    if (t?.kind === 'telephone' && r.phase === 'tell') maybeEndStep(r);
    if (t?.kind === 'classic' && t.drawer === p.id && (r.phase === 'draw' || r.phase === 'choose')) return endTurn(r, 'drawer-gone');
    if (t?.kind === 'forger' && t.forger === p.id && ['forge', 'vote', 'unmask'].includes(r.phase)) return forgerReveal(r, 'forger-gone');
    if (t?.kind === 'forger' && r.phase === 'forge' && t.stroke?.player === p.id) return nextStroke(r);
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
        teamScores: [],
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

    /** Stille Post: the drawing a player is to describe in this step. */
    prompt(code, token) {
      const r = room(code);
      const p = player(r, token);
      const t = r.turn;
      if (t?.kind !== 'telephone' || r.phase !== 'tell' || t.stepKind !== 'describe' || !t.order.includes(p.id)) throw new GameError('wrong-phase', 409);
      const prev = r.game.chains[chainOf(t, p.id)].entries[t.step - 1];
      return { turn: t.n, step: t.step, ops: prev?.drawing ? toOps(prev.drawing) : [] };
    },

    /** Stille Post: every chain, once the showcase has begun. */
    chains(code) {
      const r = room(code);
      const chains = r.game?.mode === 'telephone' ? r.game.chains : null;
      if (!chains || (r.phase !== 'showcase' && r.phase !== 'final')) throw new GameError('wrong-phase', 409);
      return chains.map((c) => ({
        owner: c.owner,
        entries: c.entries.map((e) => (e.kind === 'drawing' ? { player: e.player, kind: e.kind, ops: toOps(e.drawing) } : { player: e.player, kind: e.kind, text: e.text })),
      }));
    },

    /** The finished game's drawings, for the gallery (only once the game is over). */
    gallery(code) {
      const r = room(code);
      if (r.phase !== 'final') throw new GameError('wrong-phase', 409);
      return r.gallery.map((g) => ({ n: g.n, drawer: g.drawer, word: g.word, kind: g.kind, team: g.team ?? null, ops: toOps(g.drawing) }));
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
      for (const c of canvasesFor(r, sub.player)) send('canvas', JSON.stringify(c));
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
      const t = r.turn;

      switch (action) {
        case 'settings': {
          requireHost(r, p);
          requirePhase(r, 'lobby', 'final');
          const before = { mode: r.settings.mode, teams: r.settings.teams };
          r.settings = mergeSettings(r.settings, body);
          r.customCount = parseCustom(r.settings.custom).length;
          if (r.phase === 'lobby' && (r.settings.mode !== before.mode || r.settings.teams !== before.teams)) {
            if (r.settings.mode === 'duel' || before.mode === 'duel') spreadTeams(r);
          }
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
          if (t.drawer !== p.id) throw new GameError('not-drawer', 403);
          const index = body?.index;
          if (!Number.isInteger(index) || index < 0 || index >= t.choices.length) throw new GameError('choice');
          choose(r, index);
          return;
        }
        case 'chat': {
          say(r, p, body?.text);
          return;
        }
        case 'ink': {
          requirePhase(r, 'draw', 'forge', 'tell');
          // A batch from a turn that's over (sent just as time ran out) is dropped quietly.
          if (body?.turn !== t.n) return;
          if (t.kind === 'classic') {
            if (t.drawer !== p.id) throw new GameError('not-drawer', 403);
            sendInk(r, t.n, applyOps(t.drawing, spiceFilter(t, t.drawing, body?.ops)), { except: p.id });
            return;
          }
          if (t.kind === 'telephone') {
            // Stille Post: kept for the chain, shown to nobody until the end.
            if (r.phase !== 'tell' || t.stepKind !== 'draw' || !t.order.includes(p.id)) throw new GameError('wrong-phase', 409);
            if (!t.drawings.has(p.id)) t.drawings.set(p.id, newDrawing());
            applyOps(t.drawings.get(p.id), body?.ops);
            return;
          }
          if (t.kind === 'duel') {
            const team = t.teams.find((x) => x.drawer === p.id);
            if (!team) throw new GameError('not-drawer', 403);
            sendInk(r, t.n, applyOps(team.drawing, spiceFilter(t, team.drawing, body?.ops)), { except: p.id, team: team.team });
            return;
          }
          if (t.stroke?.player !== p.id) throw new GameError('not-drawer', 403);
          sendInk(r, t.n, applyOps(t.drawing, forgerOps(t, p, body?.ops)), { except: p.id });
          return;
        }
        case 'tell': {
          requirePhase(r, 'tell');
          tell(r, p, body?.text);
          return;
        }
        case 'done': {
          // Stille Post: this drawing is finished.
          requirePhase(r, 'tell');
          if (t.stepKind !== 'draw' || !t.order.includes(p.id)) throw new GameError('wrong-phase', 409);
          t.done.add(p.id);
          touch(r);
          maybeEndStep(r);
          return;
        }
        case 'next':
        case 'prev': {
          requireHost(r, p);
          requirePhase(r, 'showcase');
          showStep(r, action === 'next' ? 1 : -1);
          return;
        }
        case 'pass': {
          // Fälscher: the stroke is done, the next player's turn.
          requirePhase(r, 'forge');
          if (t.stroke?.player !== p.id) throw new GameError('not-drawer', 403);
          nextStroke(r);
          return;
        }
        case 'vote': {
          requirePhase(r, 'vote');
          vote(r, p, body?.player);
          return;
        }
        case 'unmask': {
          requirePhase(r, 'unmask');
          unmask(r, p, body?.text);
          return;
        }
        case 'like': {
          requirePhase(r, 'draw', 'reveal', 'forge', 'vote', 'showcase');
          if (isDrawer(t, p.id)) throw new GameError('own-drawing', 409);
          const value = body?.value;
          if (value !== 1 && value !== -1 && value !== 0) throw new GameError('like');
          if (value) t.likes.set(p.id, value);
          else t.likes.delete(p.id);
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
          requirePhase(r, 'choose', 'draw', 'forge', 'vote', 'unmask', 'tell');
          if (t.kind === 'telephone') endStep(r);
          else if (t.kind === 'duel') endDuel(r, 'skip');
          else if (t.kind === 'forger') forgerReveal(r, 'skip');
          else endTurn(r, 'skip');
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
          r.teamScores = [];
          for (const q of [...r.players.values()]) {
            if (q.left) r.players.delete(q.id);
            q.score = 0;
            q.close = 0;
          }
          if (r.settings.mode === 'duel') for (const q of present(r)) if (q.team === null || q.team >= r.settings.teams) q.team = smallestTeam(r);
          touch(r);
          return;
        }
        case 'team': {
          requirePhase(r, 'lobby');
          const team = body?.team;
          if (r.settings.mode !== 'duel' || !Number.isInteger(team) || team < 0 || team >= r.settings.teams) throw new GameError('team');
          p.team = team;
          touch(r);
          return;
        }
        case 'shuffle': {
          requireHost(r, p);
          requirePhase(r, 'lobby');
          if (r.settings.mode !== 'duel') throw new GameError('team');
          spreadTeams(r, true);
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
        if (!t) continue;
        if (t.kind === 'classic' && (r.phase === 'draw' || r.phase === 'choose')) {
          const drawer = r.players.get(t.drawer);
          if (drawer && !drawer.bot && goneFor(drawer, DRAWER_GRACE)) endTurn(r, 'drawer-gone');
          else if (r.phase === 'draw' && now >= t.endsAt + 2000) endTurn(r, 'time');
          else if (r.phase === 'choose' && now >= t.chooseEndsAt + 2000) choose(r, randomInt(t.choices.length));
        } else if (t.kind === 'duel' && r.phase === 'draw' && now >= t.endsAt + 2000) endDuel(r, 'time');
        else if (t.kind === 'forger' && r.phase === 'forge' && t.stroke) {
          const p = r.players.get(t.stroke.player);
          if (now >= t.stroke.endsAt + 2000 || (p && !p.bot && goneFor(p, STROKE_GRACE))) nextStroke(r);
        } else if (t.kind === 'forger' && r.phase === 'vote' && now >= t.endsAt + 2000) endVote(r);
        else if (t.kind === 'forger' && r.phase === 'unmask' && now >= t.endsAt + 2000) forgerReveal(r, 'caught');
        else if (t.kind === 'telephone' && r.phase === 'tell' && now >= t.endsAt + 2000) endStep(r);
        else if (r.phase === 'reveal' && now >= t.revealEndsAt + 2000) afterReveal(r);
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

  /** Fälscher: one stroke per turn, in the player's own colour, nothing else. */
  function forgerOps(t, p, ops) {
    if (!Array.isArray(ops)) return [];
    const color = t.colors.get(p.id) ?? 0;
    const out = [];
    for (const op of ops) {
      if (!Array.isArray(op)) continue;
      if (op[0] === 's' && !t.stroke.started) {
        t.stroke.started = true;
        t.stroke.id = op[1];
        out.push(['s', op[1], color, Math.min(Number(op[3]) || 1, 2), ...op.slice(4)]);
      } else if (op[0] === 'p' && t.stroke.started && op[1] === t.stroke.id) out.push(op);
    }
    return out;
  }
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
  if (SPICE_CHOICES.includes(body?.spice)) next.spice = body.spice;
  if (TEAM_CHOICES.includes(body?.teams)) next.teams = body.teams;
  if (LAP_CHOICES.includes(body?.laps)) next.laps = body.laps;
  if (STROKE_CHOICES.includes(body?.strokeSeconds)) next.strokeSeconds = body.strokeSeconds;
  return next;
}
