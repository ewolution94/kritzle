// Fair draws: the words on offer, the hints' letters and the bots' picks take a whole randomInt(n),
// node:crypto's in production (exactly uniform, by rejection), a seeded one here. The statistics on
// the real source are in fair.sim.mjs (npm run test:sim); learnings/randomness.md in the workspace
// has the why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGames } from '../server/game.mjs';
import { hintOrder, letterIndexes } from '../server/guess.mjs';
import { fairInt, seededInt } from './helpers.mjs';

/** The chi-square value df degrees of freedom stay under with probability 1 - 1e-6 (Wilson–Hilferty). */
function bound(df) {
  const z = 4.753;
  return df * (1 - 2 / (9 * df) + z * Math.sqrt(2 / (9 * df))) ** 3;
}
const chi = (count) => {
  const total = count.reduce((a, b) => a + b, 0);
  const e = total / count.length;
  return count.reduce((s, c) => s + (c - e) ** 2 / e, 0);
};

test('the seeded source owns the same count of words per number and draws again past the limit', () => {
  for (const n of [1, 2, 3, 5, 7, 10, 12, 1_000_000]) {
    const limit = Math.floor(2 ** 32 / n) * n;
    assert.equal(limit % n, 0);
    assert.ok(2 ** 32 - limit < n, 'fewer than n words are ever redrawn');
    const seq = (...ws) => () => ws.shift();
    assert.equal(fairInt(n, seq(limit - 1)), (limit - 1) % n, 'the last word kept');
    if (limit < 2 ** 32) assert.equal(fairInt(n, seq(limit, 2 ** 32 - 1, 4)), 4 % n, 'a word past the limit is drawn again');
  }
  assert.throws(() => fairInt(0, () => 0), RangeError);
  assert.throws(() => fairInt(2.5, () => 0), RangeError);
});

test('the hints are Fisher–Yates on whole numbers: one randomInt per letter, from the top down', () => {
  const asked = [];
  const top = (n) => (asked.push(n), n - 1);
  assert.deepEqual(hintOrder('Abend', 2, top), [0, 1], 'the top of every range keeps the order');
  assert.deepEqual(asked, [5, 4, 3, 2]);
  assert.deepEqual(hintOrder('Abend', 2, () => 0), [1, 2], 'the bottom of every range');
});

test('every letter is as likely to be the first hint (chi-square on a seeded source)', () => {
  const randomInt = seededInt(5);
  const word = 'Leuchtturm';
  const first = new Array(letterIndexes(word).length).fill(0);
  for (let i = 0; i < 20_000; i++) first[hintOrder(word, 1, randomInt)[0]]++;
  assert.ok(chi(first) < bound(first.length - 1), `chi-square ${chi(first).toFixed(1)} with ${first.length - 1} degrees of freedom`);
});

test('without a source of their own, the hints and the rooms draw from node:crypto, never Math.random', () => {
  const real = Math.random;
  Math.random = () => {
    throw new Error('an outcome came from Math.random');
  };
  try {
    assert.equal(hintOrder('Leuchtturm', 3).length, 3);
    // A room with bots, started: its words on offer and the bots' first moves come from the same source.
    const clock = { now: () => 1_000_000, setTimeout: () => 0, clearTimeout() {} };
    const games = createGames({ clock });
    const host = games.create({ name: 'Anna' });
    for (let i = 0; i < 3; i++) games.act(host.code, host.token, 'bot', { add: true });
    games.act(host.code, host.token, 'start');
    assert.equal(games.view(host.code).phase, 'choose');
  } finally {
    Math.random = real;
  }
});
