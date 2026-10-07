import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GameError } from '../server/game.mjs';
import { FILL_H, FILL_W } from '../server/ink.mjs';
import { drawerSeat, room, setup, watch, wordOf } from './helpers.mjs';

/** Starts the game and has the drawer pick the first word. */
function started(games, r) {
  games.act(r.code, r.host.token, 'start');
  const drawer = drawerSeat(r.seats, r.pages);
  games.act(r.code, drawer.token, 'choose', { index: 0 });
  return drawer;
}

const others = (r, drawer) => r.seats.filter((s) => s.player !== drawer.player);
const pageOf = (r, seat) => r.pages[r.seats.indexOf(seat)];

test('a game needs two players, and only the host starts it', () => {
  const { games } = setup();
  const host = games.create({ name: 'Anna' });
  assert.throws(() => games.act(host.code, host.token, 'start'), (e) => e instanceof GameError && e.code === 'too-few');
  const ben = games.join(host.code, { name: 'Ben' });
  assert.throws(() => games.act(host.code, ben.token, 'start'), (e) => e.code === 'not-host');
  games.act(host.code, host.token, 'start');
  assert.equal(games.view(host.code).phase, 'choose');
});

test('only the drawer sees the choices; then only those who know see the word', () => {
  const { games } = setup();
  const r = room(games, 2);
  games.act(r.code, r.host.token, 'start');
  const drawer = drawerSeat(r.seats, r.pages);
  const guesser = others(r, drawer)[0];
  assert.equal(pageOf(r, drawer).view.turn.choices.length, 3);
  assert.equal(pageOf(r, guesser).view.turn.choices, null);
  assert.throws(() => games.act(r.code, guesser.token, 'choose', { index: 0 }), (e) => e.code === 'not-drawer');
  games.act(r.code, drawer.token, 'choose', { index: 1 });
  const word = pageOf(r, drawer).view.turn.word;
  assert.ok(word);
  assert.equal(pageOf(r, guesser).view.turn.word, null);
  assert.equal(pageOf(r, guesser).view.turn.pattern.replace(/[^_]/g, '').length, [...word].filter((c) => /\p{L}/u.test(c)).length);
  // The big screen never knows.
  const screen = watch(games, r.code, null);
  assert.equal(screen.view.turn.word, null);
});

test('a right guess is never echoed, scores at the end, and moves its chat to those who know', () => {
  const { games } = setup();
  const r = room(games, 2);
  const drawer = started(games, r);
  const [a, b] = others(r, drawer);
  const word = wordOf(r.seats, r.pages);
  games.act(r.code, a.token, 'chat', { text: word.toUpperCase() });
  for (const page of r.pages) {
    assert.ok(!page.chat.some((l) => l.text && l.text.toLowerCase() === word.toLowerCase()), 'the word was echoed');
    assert.ok(page.chat.some((l) => l.kind === 'guessed' && l.player === a.player));
  }
  assert.equal(pageOf(r, a).view.turn.word, word);
  assert.equal(pageOf(r, b).view.turn.word, null);
  // a now talks only to those who know.
  games.act(r.code, a.token, 'chat', { text: 'easy one' });
  assert.ok(pageOf(r, drawer).chat.some((l) => l.text === 'easy one' && l.private));
  assert.ok(!pageOf(r, b).chat.some((l) => l.text === 'easy one'));
  // Saying the word again, or the drawer saying it, is refused.
  assert.throws(() => games.act(r.code, a.token, 'chat', { text: word }), (e) => e.code === 'spoiler');
  assert.throws(() => games.act(r.code, drawer.token, 'chat', { text: word }), (e) => e.code === 'spoiler');
  // A second guess can't score twice; scores land at the turn's end.
  assert.equal(pageOf(r, a).view.players.find((p) => p.id === a.player).score, 0);
});

test('everyone guessing ends the turn early; points reach the drawer too', () => {
  const { games, clock } = setup();
  const r = room(games, 2);
  const drawer = started(games, r);
  const word = wordOf(r.seats, r.pages);
  clock.advance(10_000);
  for (const s of others(r, drawer)) games.act(r.code, s.token, 'chat', { text: word });
  assert.equal(r.pages[0].view.phase, 'draw');
  clock.advance(1_300);
  const v = r.pages[0].view;
  assert.equal(v.phase, 'reveal');
  assert.equal(v.turn.word, word);
  assert.equal(v.turn.ended, 'all');
  const scores = Object.fromEntries(v.players.map((p) => [p.id, p.score]));
  const [first, second] = others(r, drawer);
  assert.ok(scores[first.player] > scores[second.player], 'the first to guess gets more');
  assert.ok(scores[drawer.player] > 0);
  assert.ok(r.pages[0].chat.some((l) => l.kind === 'word' && l.text === word));
});

test('a near miss shows in the chat, with a nudge only for the guesser', () => {
  const { games } = setup();
  const r = room(games, 2);
  const drawer = started(games, r);
  const [a, b] = others(r, drawer);
  const word = wordOf(r.seats, r.pages);
  const typo = word.length >= 4 ? word.slice(0, -1) + (word.at(-1) === 'x' ? 'y' : 'x') : null;
  if (!typo) return;
  games.act(r.code, a.token, 'chat', { text: typo });
  assert.ok(pageOf(r, b).chat.some((l) => l.kind === 'msg' && l.text === typo));
  assert.ok(pageOf(r, a).chat.some((l) => l.kind === 'close' && l.private));
  assert.ok(!pageOf(r, b).chat.some((l) => l.kind === 'close'));
});

test('hints uncover letters as the clock runs', () => {
  const { games, clock } = setup();
  const r = room(games, 1);
  games.act(r.code, r.host.token, 'settings', { hints: 2, seconds: 80, words: 1 });
  const drawer = started(games, r);
  const guesser = others(r, drawer)[0];
  const blanks = () => pageOf(r, guesser).view.turn.pattern.split('').filter((c) => c === '_').length;
  const before = blanks();
  clock.advance(28_500);
  const hints = pageOf(r, guesser).view.turn.hints;
  assert.equal(blanks(), before - hints);
  assert.ok(hints >= 1 || before < 2);
});

test('hidden words show no blanks until the first hint; combinations want both words', () => {
  const { games, clock } = setup();
  const r = room(games, 1);
  games.act(r.code, r.host.token, 'settings', { wordMode: 'hidden', hints: 1 });
  const drawer = started(games, r);
  const guesser = others(r, drawer)[0];
  assert.equal(pageOf(r, guesser).view.turn.pattern, null);
  clock.advance(48_000);
  const word = wordOf(r.seats, r.pages);
  if (word.replace(/[^\p{L}]/gu, '').length >= 2) assert.ok(pageOf(r, guesser).view.turn.pattern);

  const second = setup();
  const r2 = room(second.games, 1);
  second.games.act(r2.code, r2.host.token, 'settings', { wordMode: 'combo' });
  const d2 = started(second.games, r2);
  const g2 = others(r2, d2)[0];
  const combo = wordOf(r2.seats, r2.pages);
  assert.match(combo, / \+ /);
  const [one, two] = combo.split(' + ');
  second.games.act(r2.code, g2.token, 'chat', { text: one });
  assert.ok(pageOf(r2, g2).chat.some((l) => l.kind === 'half'));
  assert.equal(pageOf(r2, g2).view.turn.word, null);
  second.games.act(r2.code, g2.token, 'chat', { text: `${two} ${one}` });
  assert.equal(pageOf(r2, g2).view.turn.word, combo);
});

test('ink: only the drawer draws; everyone else gets it; a late page gets the whole drawing', () => {
  const { games } = setup();
  const r = room(games, 2);
  const drawer = started(games, r);
  const guesser = others(r, drawer)[0];
  const n = r.pages[0].view.turn.n;
  assert.throws(() => games.act(r.code, guesser.token, 'ink', { turn: n, ops: [['s', 1, 0, 0, 5, 5, 0]] }), (e) => e.code === 'not-drawer');
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['s', 1, 2, 1, 10, 10, 0], ['p', 1, 20, 20, 16]] });
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['f', 5, [10, 20, FILL_W * FILL_H - 30], 40]] });
  assert.equal(pageOf(r, guesser).ink.length, 2);
  assert.equal(pageOf(r, drawer).ink.length, 0, 'the drawer drew it already');
  // A batch from an old turn is dropped quietly.
  games.act(r.code, drawer.token, 'ink', { turn: n - 1, ops: [['s', 9, 0, 0, 1, 1, 0]] });
  assert.equal(pageOf(r, guesser).ink.length, 2);
  const late = watch(games, r.code, null);
  assert.deepEqual(late.canvas.at(-1), { turn: n, team: null, ops: [['s', 1, 2, 1, 10, 10, 0], ['p', 1, 20, 20, 16], ['f', 5, [10, 20, FILL_W * FILL_H - 30], 40]] });
});

test('a whole game with bots: every player draws each round, then the podium and the gallery', () => {
  const { games, clock } = setup();
  const host = games.create({ name: 'Anna' });
  const page = watch(games, host.code, host.player);
  games.act(host.code, host.token, 'bot', { add: true });
  games.act(host.code, host.token, 'bot', { add: true });
  games.act(host.code, host.token, 'settings', { rounds: 2, seconds: 30 });
  assert.equal(page.view.players.filter((p) => p.bot).length, 2);
  games.act(host.code, host.token, 'start');
  const drawers = [];
  for (let step = 0; step < 400 && page.view.phase !== 'final'; step++) {
    const v = page.view;
    if (v.phase === 'choose' && v.turn.drawer === host.player && v.turn.choices) {
      drawers.push(host.player);
      games.act(host.code, host.token, 'choose', { index: 0 });
      games.act(host.code, host.token, 'ink', { turn: page.view.turn.n, ops: [['s', 1, 0, 1, 100, 100, 0], ['p', 1, 200, 200, 30]] });
      continue;
    }
    if (v.phase === 'draw' && v.turn.drawer !== host.player && !drawers.includes(`${v.turn.n}`)) drawers.push(`${v.turn.n}`);
    clock.advance(1000);
  }
  assert.equal(page.view.phase, 'final');
  const final = page.view.final;
  assert.equal(final.drawings.length, 6, 'three players, two rounds');
  assert.ok(final.awards);
  const gallery = games.gallery(host.code);
  assert.equal(gallery.length, 6);
  assert.ok(gallery.some((g) => g.ops.length > 0));
  games.act(host.code, host.token, 'rematch');
  assert.equal(page.view.phase, 'lobby');
  assert.ok(page.view.players.every((p) => p.score === 0));
});

test('a drawer who leaves ends the turn; the host hands over and a lone player ends the game', () => {
  const { games } = setup();
  const r = room(games, 2);
  const drawer = started(games, r);
  games.act(r.code, drawer.token, 'leave');
  const watcher = r.pages[r.seats.indexOf(others(r, drawer)[0])];
  assert.equal(watcher.view.phase, 'reveal');
  assert.equal(watcher.view.turn.ended, 'drawer-gone');
  const rest = others(r, drawer);
  games.act(r.code, rest[1].token, 'leave');
  assert.equal(watcher.view.phase, 'final');
});

test('the host’s own words stay hidden from the others; too few of them refuse the start', () => {
  const { games } = setup();
  const r = room(games, 1);
  games.act(r.code, r.host.token, 'settings', { custom: 'Daily, Retro, Sprint', onlyCustom: true });
  assert.equal(r.pages[0].view.settings.custom, 'Daily, Retro, Sprint');
  assert.equal(r.pages[1].view.settings.custom, '');
  assert.equal(r.pages[1].view.settings.customCount, 3);
  assert.throws(() => games.act(r.code, r.host.token, 'start'), (e) => e.code === 'custom-few');
});

test('blitz loads its preset; likes and reactions', () => {
  const { games } = setup();
  const r = room(games, 2);
  games.act(r.code, r.host.token, 'settings', { mode: 'blitz' });
  assert.deepEqual(
    (({ rounds, seconds, words, hints }) => ({ rounds, seconds, words, hints }))(r.pages[0].view.settings),
    { rounds: 2, seconds: 45, words: 1, hints: 3 },
  );
  const drawer = started(games, r);
  const fan = others(r, drawer)[0];
  games.act(r.code, fan.token, 'like', { value: 1 });
  assert.equal(pageOf(r, fan).view.turn.like, 1);
  assert.equal(r.pages[0].view.turn.likes, 1);
  assert.throws(() => games.act(r.code, drawer.token, 'like', { value: 1 }), (e) => e.code === 'own-drawing');
  games.act(r.code, fan.token, 'react', { e: 1 });
  games.act(r.code, fan.token, 'react', { e: 2 });
  assert.equal(r.pages[0].reacts.length, 1, 'reactions are rate-limited');
});
