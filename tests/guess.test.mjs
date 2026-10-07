import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, hintOrder, hintTimes, judge, letterIndexes, normalize, pattern } from '../server/guess.mjs';
import { combine, entry } from '../server/words/index.mjs';

test('normalising ignores case, umlauts, ß, accents, spaces and hyphens', () => {
  assert.equal(normalize('Fußball'), 'fussball');
  assert.equal(normalize('FUSSBALL'), 'fussball');
  assert.equal(normalize('Käse'), 'kaese');
  assert.equal(normalize('Kaese'), 'kaese');
  assert.equal(normalize('Crème brûlée'), 'cremebrulee');
  assert.equal(normalize('T-Shirt'), 'tshirt');
  assert.equal(normalize(' Erste  Hilfe! '), 'erstehilfe');
});

test('a right guess, an alias, and the spelling that never decides', () => {
  const handy = entry('Handy|Smartphone|Mobiltelefon', 'easy', 'things');
  assert.equal(judge(handy, 'handy'), 'right');
  assert.equal(judge(handy, 'Smart-Phone'), 'right');
  assert.equal(judge(handy, 'Mobiltelefon'), 'right');
  assert.equal(judge(entry('Käse', 'easy', 'food'), 'kaese'), 'right');
  assert.equal(judge(entry('Fußball', 'easy', 'sports'), 'FUSSBALL'), 'right');
});

test('close is one edit away, two from eight letters on', () => {
  const tower = entry('Leuchtturm', 'medium', 'places');
  assert.equal(judge(tower, 'Leuchtturn'), 'close');
  assert.equal(judge(tower, 'Leuchturm'), 'close');
  assert.equal(judge(tower, 'Leuchtrum'), 'close');
  assert.equal(judge(tower, 'Turm'), null);
  const cat = entry('Katze', 'easy', 'animals');
  assert.equal(judge(cat, 'Kotze'), 'close');
  assert.equal(judge(cat, 'Kotzi'), null);
  assert.equal(judge(cat, 'Kat'), null);
  // Too short to be "close" to anything.
  assert.equal(judge(entry('Ei', 'easy', 'food'), 'Eo'), null);
  assert.equal(distance('huhn', 'hunh'), 1);
});

test('a combination wants both words, in any order', () => {
  const combo = combine(entry('Hund', 'easy', 'animals'), entry('Hut', 'easy', 'everyday'));
  assert.equal(combo.word, 'Hund + Hut');
  assert.equal(judge(combo, 'Hund Hut'), 'right');
  assert.equal(judge(combo, 'hut und hund'), 'right');
  assert.equal(judge(combo, 'Hund'), 'half');
  assert.equal(judge(combo, 'Katze'), null);
  assert.equal(combo.difficulty, 'medium');
});

test('the blanks keep spaces, hyphens and the plus; hints never give away more than half', () => {
  assert.equal(pattern('Erste Hilfe', new Set()), '_____ _____');
  assert.equal(pattern('T-Shirt', new Set([0])), 'T-_____');
  assert.equal(pattern('Hund + Hut', new Set()), '____ + ___');
  assert.deepEqual(letterIndexes('A-B c'), [0, 2, 4]);
  const order = hintOrder('Leuchtturm', 5, () => 0.3);
  assert.equal(order.length, 5);
  assert.equal(new Set(order).size, 5);
  assert.equal(hintOrder('Ei', 3).length, 1);
  assert.equal(hintOrder('Hut', 3).length, 1);
  assert.deepEqual(hintTimes(0, 80_000), []);
  const times = hintTimes(3, 80_000);
  assert.deepEqual(times, [28_000, 48_000, 68_000]);
  assert.ok(hintTimes(3, 45_000, true)[0] < hintTimes(3, 45_000)[0]);
});
