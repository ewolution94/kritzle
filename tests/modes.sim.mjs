// Simulated games for the modes: a whole Team duel played out through a room, on a fake clock.
// Not in CI (the user, 2026-10-20: "rely on simpler (unit) tests there"); run them with `npm run test:sim`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORGER_COLORS, FORGER_POINTS, INK_BUDGET } from '../server/game.mjs';
import { FILL_H, FILL_W } from '../server/ink.mjs';
import { room, setup, watch } from './helpers.mjs';

const pageOf = (r, id) => r.pages[r.seats.findIndex((s) => s.player === id)];
const seatOf = (r, id) => r.seats.find((s) => s.player === id);

/** A team duel with four people in two teams, started. */
function duelGame() {
  const { games, clock } = setup();
  const r = room(games, 3);
  games.act(r.code, r.host.token, 'settings', { mode: 'duel', teams: 2 });
  games.act(r.code, r.host.token, 'start');
  return { games, clock, r };
}

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
