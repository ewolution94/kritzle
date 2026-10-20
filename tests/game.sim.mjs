// Simulated games for the game: whole games played out through a room by bots, on a fake clock.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
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

test('a game that ends on its own is not marked as ended early', () => {
  const { clock, games } = setup();
  const host = games.create({ name: 'Anna', avatar: [1, 0, 0, 0, 0] });
  const page = watch(games, host.code, host.player);
  games.act(host.code, host.token, 'settings', { rounds: 2 });
  games.act(host.code, host.token, 'bot', { add: true });
  games.act(host.code, host.token, 'start');
  for (let i = 0; i < 400 && page.view.phase !== 'final'; i++) {
    if (page.view.turn?.drawer === host.player && page.view.phase === 'choose') games.act(host.code, host.token, 'choose', { index: 0 });
    clock.advance(1000);
    games.tick();
  }
  assert.equal(page.view.phase, 'final');
  assert.equal(page.view.final.ended, null);
});
