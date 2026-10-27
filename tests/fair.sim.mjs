// The draws on their real source, node:crypto's randomInt: the hints' first letter and the words on
// offer. Stochastic, so local only (npm run test:sim, the workspace's CLAUDE.md): a fair source fails
// these 1-in-a-million bounds once in a million runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { hintOrder, letterIndexes } from '../server/guess.mjs';
import { choices } from '../server/words/index.mjs';

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

test('node:crypto: in a million hint orders every letter comes first as often', () => {
  const word = 'Leuchtturm';
  const first = new Array(letterIndexes(word).length).fill(0);
  for (let i = 0; i < 1_000_000; i++) first[hintOrder(word, 1)[0]]++;
  console.log(`  first hint: chi-square ${chi(first).toFixed(1)} (bound ${bound(first.length - 1).toFixed(1)})`);
  assert.ok(chi(first) < bound(first.length - 1));
});

test('node:crypto: in a million offers every word of a list is offered as often', () => {
  const from = Array.from({ length: 12 }, (_, i) => ({ word: `Wort${i}`, answers: [`Wort${i}`], difficulty: 'easy', pack: 'test' }));
  const offered = new Map();
  for (let i = 0; i < 1_000_000; i++) {
    const [e] = choices(from, 1, new Set(), false, (n) => randomInt(n));
    offered.set(e.word, (offered.get(e.word) ?? 0) + 1);
  }
  const count = [...offered.values()];
  console.log(`  offers: chi-square ${chi(count).toFixed(1)} (bound ${bound(11).toFixed(1)})`);
  assert.equal(count.length, 12);
  assert.ok(chi(count) < bound(11));
});
