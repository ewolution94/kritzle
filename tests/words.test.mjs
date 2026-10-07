import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../server/guess.mjs';
import { CUSTOM_LIMITS, DIFFICULTIES, LANGS, LISTS, PACKS, choices, counts, parseCustom, pool } from '../server/words/index.mjs';
import { seededInt } from './helpers.mjs';

test('both lists have every pack in every difficulty, and no repeats', () => {
  for (const lang of LANGS) {
    assert.deepEqual(Object.keys(LISTS[lang]), PACKS);
    const seen = new Set();
    for (const pack of PACKS) {
      for (const d of DIFFICULTIES) {
        const list = LISTS[lang][pack][d];
        assert.ok(list.length >= 10, `${lang} ${pack} ${d}`);
        for (const raw of list) {
          assert.match(raw, /^[\p{L} -]{1,24}(\|[\p{L} -]{1,24})*$/u, raw);
          const key = normalize(raw.split('|')[0]);
          assert.ok(!seen.has(key), `${lang}: ${raw} twice`);
          seen.add(key);
        }
      }
    }
    assert.ok(counts[lang] >= 350, `${lang}: ${counts[lang]} words`);
  }
});

test('the pool follows language, packs and difficulty, and custom words join it', () => {
  const base = { lang: 'de', packs: ['animals'], difficulty: 'easy', custom: '', onlyCustom: false };
  const animals = pool(base);
  assert.ok(animals.length > 5 && animals.every((e) => e.pack === 'animals' && e.difficulty === 'easy'));
  const withCustom = pool({ ...base, custom: 'Kaffeeklatsch, Daily' });
  assert.equal(withCustom.length, animals.length + 2);
  assert.deepEqual(pool({ ...base, custom: 'Kaffeeklatsch', onlyCustom: true }).map((e) => e.word), ['Kaffeeklatsch']);
  assert.ok(pool({ ...base, lang: 'en' }).every((e) => /^[a-z ]/.test(e.word) || e.word === e.word.toLowerCase()));
});

test('custom words: separators, cleaning, aliases, repeats and limits', () => {
  assert.deepEqual(parseCustom('Daily, Retro;Sprint\nKaffee|Kaffeepause , ,daily'), ['Daily', 'Retro', 'Sprint', 'Kaffee|Kaffeepause']);
  assert.deepEqual(parseCustom('<b>Fett</b>!!, 1:1-Gespräch'), ['bFettb', '11-Gespräch']);
  const many = Array.from({ length: 700 }, (_, i) => `Wort${i}`).join(',');
  assert.equal(parseCustom(many).length, CUSTOM_LIMITS.words);
  assert.deepEqual(parseCustom(42), []);
});

test('choices are different words the game has not had yet', () => {
  const from = pool({ lang: 'de', packs: PACKS, difficulty: 'mixed', custom: '', onlyCustom: false });
  const seen = new Set(from.slice(0, from.length - 5).map((e) => e.word));
  const picked = choices(from, 3, seen, false, seededInt(3));
  assert.equal(picked.length, 3);
  assert.equal(new Set(picked.map((e) => e.word)).size, 3);
  for (const e of picked) assert.ok(!seen.has(e.word));
  const combos = choices(from, 2, new Set(), true, seededInt(4));
  assert.ok(combos.every((e) => e.parts?.length === 2 && e.word.includes(' + ')));
});
