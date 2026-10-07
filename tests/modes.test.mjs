import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORGER_COLORS, FORGER_POINTS, INK_BUDGET } from '../server/game.mjs';
import { FILL_H, FILL_W } from '../server/ink.mjs';
import { room, setup, watch } from './helpers.mjs';

const pageOf = (r, id) => r.pages[r.seats.findIndex((s) => s.player === id)];
const seatOf = (r, id) => r.seats.find((s) => s.player === id);

/** A classic game with a spice, at the drawer's first turn with the word chosen. */
function spiced(spice) {
  const { games, clock } = setup();
  const r = room(games, 2);
  games.act(r.code, r.host.token, 'settings', { spice });
  games.act(r.code, r.host.token, 'start');
  const drawer = seatOf(r, r.pages[0].view.turn.drawer);
  games.act(r.code, drawer.token, 'choose', { index: 0 });
  const n = r.pages[0].view.turn.n;
  const guest = r.seats.find((s) => s !== drawer);
  return { games, clock, r, drawer, guest, n };
}

test('Würze "one stroke": a second stroke and fills are dropped', () => {
  const { games, r, drawer, guest, n } = spiced('oneline');
  assert.equal(pageOf(r, guest.player).view.turn.spice, 'oneline');
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['s', 1, 0, 1, 10, 10, 0], ['p', 1, 20, 20, 10]] });
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['s', 2, 0, 1, 50, 50, 20], ['f', 4, [FILL_W * FILL_H], 30]] });
  const ops = pageOf(r, guest.player).ink.flatMap((b) => b.ops);
  assert.deepEqual(ops.map((op) => op[0]), ['s', 'p']);
});

test('Würze "little ink": the drawing stops at the budget', () => {
  const { games, r, drawer, guest, n } = spiced('ink');
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push(i % 800, 100, i);
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['s', 1, 0, 1, 0, 0, 0], ['p', 1, ...pts]] });
  const total = pageOf(r, guest.player).ink.flatMap((b) => b.ops).reduce((sum, op) => sum + (op[0] === 's' ? 1 : (op.length - 2) / 3), 0);
  assert.equal(total, INK_BUDGET);
});

test('Würze "three colours": everyone sees the three; other colours are dropped, the eraser stays', () => {
  const { games, r, drawer, guest, n } = spiced('three');
  const palette = pageOf(r, guest.player).view.turn.palette;
  assert.equal(palette.length, 3);
  const outside = [...Array(24).keys()].find((c) => !palette.includes(c) && c !== 3);
  games.act(r.code, drawer.token, 'ink', { turn: n, ops: [['s', 1, outside, 1, 5, 5, 0], ['s', 2, palette[1], 1, 5, 5, 0], ['s', 3, 3, 1, 5, 5, 0]] });
  const strokes = pageOf(r, guest.player).ink.flatMap((b) => b.ops).filter((op) => op[0] === 's');
  assert.deepEqual(strokes.map((op) => op[2]), [palette[1], 3]);
});

test('Würze "random" picks one per turn', () => {
  const { r, guest } = spiced('random');
  assert.ok(['blind', 'oneline', 'ink', 'three', 'mirror', 'shaky'].includes(pageOf(r, guest.player).view.turn.spice));
});

/** A Fälscher game with four people (the host and three), started. */
function forgerGame() {
  const { games, clock } = setup();
  const r = room(games, 3);
  games.act(r.code, r.host.token, 'settings', { mode: 'forger' });
  games.act(r.code, r.host.token, 'start');
  const any = r.pages[0].view.turn;
  const forgerId = r.pages.find((p) => p.view.turn.forgerMe).view.me;
  return { games, clock, r, forgerId, order: any.order };
}

test('Fälscher: needs three; everyone but the forger knows the word, the big screen never does', () => {
  const { games } = setup();
  const two = room(games, 1);
  games.act(two.code, two.host.token, 'settings', { mode: 'forger' });
  assert.throws(() => games.act(two.code, two.host.token, 'start'), (e) => e.code === 'too-few-forger');

  const { games: g, r, forgerId } = forgerGame();
  assert.equal(r.pages[0].view.phase, 'forge');
  for (const page of r.pages) {
    const t = page.view.turn;
    assert.ok(t.category);
    if (page.view.me === forgerId) {
      assert.equal(t.word, null);
      assert.equal(t.forgerMe, true);
    } else assert.ok(t.word);
    assert.equal(t.forger, null, 'nobody is told who the forger is');
  }
  const screen = watch(g, r.code, null);
  assert.equal(screen.view.turn.word, null);
});

test('Fälscher: one stroke per turn, in your own colour, then the next player', () => {
  const { games, r, order } = forgerGame();
  assert.notEqual(order[0], r.pages.find((p) => p.view.turn.forgerMe).view.me, 'the forger never opens');
  const first = seatOf(r, order[0]);
  const second = seatOf(r, order[1]);
  const n = r.pages[0].view.turn.n;
  assert.throws(() => games.act(r.code, second.token, 'ink', { turn: n, ops: [['s', 1, 0, 1, 5, 5, 0]] }), (e) => e.code === 'not-drawer');
  games.act(r.code, first.token, 'ink', { turn: n, ops: [['s', 1, 21, 4, 5, 5, 0], ['p', 1, 50, 50, 10], ['s', 2, 0, 1, 80, 80, 20]] });
  const seen = pageOf(r, second.player).ink.flatMap((b) => b.ops);
  assert.deepEqual(seen.map((op) => op[0]), ['s', 'p'], 'a second stroke is dropped');
  assert.equal(seen[0][2], FORGER_COLORS[0], 'the colour is the player’s own');
  games.act(r.code, first.token, 'pass');
  assert.equal(r.pages[0].view.turn.stroke.player, order[1]);
});

test('Fälscher: after the laps, the vote; caught, the forger names the word and still scores', () => {
  const { games, clock, r, forgerId, order } = forgerGame();
  const n = r.pages[0].view.turn.n;
  for (let i = 0; i < order.length * 2; i++) {
    const id = r.pages[0].view.turn.stroke.player;
    games.act(r.code, seatOf(r, id).token, 'ink', { turn: n, ops: [['s', i, 0, 1, 10 + i, 10, 0]] });
    games.act(r.code, seatOf(r, id).token, 'pass');
  }
  assert.equal(r.pages[0].view.phase, 'vote');
  const word = r.pages.find((p) => p.view.me !== forgerId).view.turn.word;
  // An artist can't write the word in the chat.
  const artist = r.seats.find((s) => s.player !== forgerId);
  assert.throws(() => games.act(r.code, artist.token, 'chat', { text: word }), (e) => e.code === 'spoiler');
  for (const s of r.seats) {
    const target = s.player === forgerId ? artist.player : forgerId;
    games.act(r.code, s.token, 'vote', { player: target });
  }
  clock.advance(900);
  assert.equal(r.pages[0].view.phase, 'unmask');
  assert.equal(r.pages[0].view.turn.caught, true);
  const forger = seatOf(r, forgerId);
  games.act(r.code, forger.token, 'unmask', { text: word });
  const v = r.pages[0].view;
  assert.equal(v.phase, 'reveal');
  assert.equal(v.turn.forger, forgerId);
  assert.equal(v.turn.forgerRight, true);
  assert.equal(v.players.find((p) => p.id === forgerId).score, FORGER_POINTS.guessed);
});

test('Fälscher: a tie lets the forger escape', () => {
  const { games, clock, r, forgerId, order } = forgerGame();
  for (let i = 0; i < order.length * 2; i++) {
    const id = r.pages[0].view.turn.stroke.player;
    games.act(r.code, seatOf(r, id).token, 'pass');
  }
  // Everyone gets one vote: a four-way tie, so nobody is caught.
  const others = order.filter((id) => id !== forgerId);
  games.act(r.code, seatOf(r, others[0]).token, 'vote', { player: others[1] });
  games.act(r.code, seatOf(r, others[1]).token, 'vote', { player: others[0] });
  games.act(r.code, seatOf(r, others[2]).token, 'vote', { player: forgerId });
  assert.throws(() => games.act(r.code, seatOf(r, forgerId).token, 'vote', { player: forgerId }), (e) => e.code === 'vote');
  games.act(r.code, seatOf(r, forgerId).token, 'vote', { player: others[2] });
  clock.advance(900);
  const v = r.pages[0].view;
  assert.equal(v.phase, 'reveal');
  assert.equal(v.turn.ended, 'escaped');
  assert.equal(v.players.find((p) => p.id === forgerId).score, FORGER_POINTS.escaped);
});

/** A team duel with four people in two teams, started. */
function duelGame() {
  const { games, clock } = setup();
  const r = room(games, 3);
  games.act(r.code, r.host.token, 'settings', { mode: 'duel', teams: 2 });
  games.act(r.code, r.host.token, 'start');
  return { games, clock, r };
}

test('Team duel: teams in the lobby, a drawer per team, the same word', () => {
  const { games } = setup();
  const r = room(games, 3);
  games.act(r.code, r.host.token, 'settings', { mode: 'duel', teams: 2 });
  const teams = r.pages[0].view.players.map((p) => p.team);
  assert.deepEqual([...teams].sort(), [0, 0, 1, 1]);
  games.act(r.code, r.seats[1].token, 'team', { team: 1 });
  games.act(r.code, r.host.token, 'shuffle');
  games.act(r.code, r.host.token, 'start');
  const v = r.pages[0].view;
  assert.equal(v.phase, 'draw');
  assert.equal(v.turn.kind, 'duel');
  assert.equal(v.turn.teams.length, 2);
  const drawers = v.turn.teams.map((x) => x.drawer);
  const words = drawers.map((id) => pageOf(r, id).view.turn.word);
  assert.ok(words[0] && words[0] === words[1], 'both drawers get the same word');
  const guesser = r.pages.find((p) => !drawers.includes(p.view.me));
  assert.equal(guesser.view.turn.word, null);
});

test('Team duel: ink and chat stay in the team; the first team to guess scores more', () => {
  const { games, clock, r } = duelGame();
  const t = r.pages[0].view.turn;
  const [a, b] = t.teams;
  const word = pageOf(r, a.drawer).view.turn.word;
  const players = r.pages[0].view.players;
  const mate = (team) => players.find((p) => p.team === team.team && p.id !== team.drawer);
  const aMate = mate(a);
  const bMate = mate(b);
  games.act(r.code, seatOf(r, a.drawer).token, 'ink', { turn: t.n, ops: [['s', 1, 0, 1, 5, 5, 0]] });
  assert.equal(pageOf(r, aMate.id).ink.length, 1);
  assert.equal(pageOf(r, bMate.id).ink.length, 0, 'the other team never sees it');
  assert.equal(pageOf(r, aMate.id).ink[0].team, a.team);
  games.act(r.code, seatOf(r, aMate.id).token, 'chat', { text: 'ein Turm?' });
  assert.ok(pageOf(r, a.drawer).chat.some((l) => l.text === 'ein Turm?'));
  assert.ok(!pageOf(r, bMate.id).chat.some((l) => l.text === 'ein Turm?'), 'guesses stay in the team');
  clock.advance(5000);
  games.act(r.code, seatOf(r, aMate.id).token, 'chat', { text: word });
  assert.ok(pageOf(r, bMate.id).chat.some((l) => l.kind === 'team' && l.text === String(a.team)), 'everyone hears a team got it');
  assert.equal(pageOf(r, aMate.id).view.turn.word, word);
  clock.advance(5000);
  games.act(r.code, seatOf(r, bMate.id).token, 'chat', { text: word });
  clock.advance(1300);
  const v = r.pages[0].view;
  assert.equal(v.phase, 'reveal');
  assert.ok(v.teams[a.team] > v.teams[b.team], 'the first team scores more');
  assert.equal(v.players.find((p) => p.id === a.drawer).score, v.teams[a.team], 'the drawer shares the team’s points');
  // At the end everyone gets every team's canvas.
  assert.ok(pageOf(r, bMate.id).canvas.some((c) => c.team === a.team && c.turn === t.n));
});

test('Team duel: a whole game to the end, one gallery drawing per team and turn', () => {
  const { games, clock, r } = duelGame();
  for (let i = 0; i < 300 && r.pages[0].view.phase !== 'final'; i++) {
    const v = r.pages[0].view;
    if (v.phase === 'draw') games.act(r.code, r.host.token, 'skip');
    clock.advance(1000);
  }
  assert.equal(r.pages[0].view.phase, 'final');
  // Two rounds, two members per team: four turns, two drawings each.
  assert.equal(r.pages[0].view.final.drawings.length, 8);
  assert.ok(r.pages[0].view.final.drawings.every((d) => d.kind === 'duel' && d.team !== null));
});

test('Stille Post: write, draw, describe; every chain passes everyone; nobody sees a drawing until the end', () => {
  const { games, clock } = setup();
  const r = room(games, 2);
  games.act(r.code, r.host.token, 'settings', { mode: 'telephone' });
  games.act(r.code, r.host.token, 'start');
  const v = r.pages[0].view;
  assert.equal(v.phase, 'tell');
  assert.equal(v.turn.stepKind, 'write');
  assert.equal(v.turn.steps, 3);
  // Step 0: everyone writes a phrase.
  r.seats.forEach((s, i) => games.act(r.code, s.token, 'tell', { text: `Satz ${i}` }));
  clock.advance(700);
  assert.equal(r.pages[0].view.turn.stepKind, 'draw');
  // Each draws someone else's phrase, in private.
  const prompts = r.pages.map((p) => p.view.turn.prompt);
  assert.equal(new Set(prompts).size, 3);
  r.pages.forEach((p, i) => assert.notEqual(p.view.turn.prompt, `Satz ${i}`, 'never your own phrase'));
  const n = r.pages[0].view.turn.n;
  r.seats.forEach((s, i) => games.act(r.code, s.token, 'ink', { turn: n, ops: [['s', 1, i, 1, 10 * (i + 1), 10, 0]] }));
  for (const page of r.pages) assert.equal(page.ink.length, 0, 'drawings stay private');
  r.seats.forEach((s) => games.act(r.code, s.token, 'done'));
  clock.advance(700);
  assert.equal(r.pages[0].view.turn.stepKind, 'describe');
  assert.equal(r.pages[0].view.turn.promptDrawing, true);
  // The drawing to describe is the one drawn from this chain's phrase.
  const prompt = games.prompt(r.code, r.seats[0].token);
  assert.equal(prompt.ops.length, 1);
  assert.throws(() => games.act(r.code, r.seats[0].token, 'done'), (e) => e.code === 'wrong-phase');
  r.seats.forEach((s, i) => games.act(r.code, s.token, 'tell', { text: `Bild ${i}` }));
  clock.advance(700);
  // Three steps for three players: the showcase.
  assert.equal(r.pages[0].view.phase, 'showcase');
  const chains = games.chains(r.code);
  assert.equal(chains.length, 3);
  for (const c of chains) assert.deepEqual(c.entries.map((e) => e.kind), ['text', 'drawing', 'text']);
  // The host steps through every entry of every chain, then the game ends.
  assert.throws(() => games.act(r.code, r.seats[1].token, 'next'), (e) => e.code === 'not-host');
  for (let i = 0; i < 9; i++) games.act(r.code, r.host.token, 'next');
  assert.equal(r.pages[0].view.phase, 'final');
  const gallery = games.gallery(r.code);
  assert.equal(gallery.length, 3);
  assert.ok(gallery.every((g) => g.kind === 'telephone' && g.word.startsWith('Satz')));
});

test('Stille Post: needs three; a missing phrase or drawing gets a stand-in when time runs out', () => {
  const { games, clock } = setup();
  const two = room(games, 1);
  games.act(two.code, two.host.token, 'settings', { mode: 'telephone' });
  assert.throws(() => games.act(two.code, two.host.token, 'start'), (e) => e.code === 'too-few-three');

  const r = room(games, 2);
  games.act(r.code, r.host.token, 'settings', { mode: 'telephone' });
  games.act(r.code, r.host.token, 'start');
  clock.advance(46_000);
  assert.equal(r.pages[0].view.turn.stepKind, 'draw');
  assert.ok(r.pages.every((p) => p.view.turn.prompt), 'a suggested word stands in for a missing phrase');
});
