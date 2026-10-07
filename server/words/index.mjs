// The words: the built-in lists (de.mjs, en.mjs; by pack and difficulty), the host's own words,
// and the drawer's choices. An entry's answers are normalised once here (server/guess.mjs).

import de from './de.mjs';
import en from './en.mjs';
import { normalize } from '../guess.mjs';

export const LISTS = Object.freeze({ de, en });
export const LANGS = Object.freeze(['de', 'en']);
export const PACKS = Object.freeze(Object.keys(de));
export const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);

export const CUSTOM_LIMITS = Object.freeze({ words: 500, length: 30, text: 6000, min: 10 });

/** @typedef {import('../guess.mjs').Entry} Entry */

/** @returns {Entry} */
export function entry(raw, difficulty, pack) {
  const [word, ...aliases] = String(raw).split('|').map((s) => s.trim());
  const answers = [...new Set([word, ...aliases].map(normalize).filter(Boolean))];
  return { word, answers, difficulty, pack };
}

/** Every built-in entry of one language, once. */
const BUILT_IN = Object.fromEntries(
  LANGS.map((lang) => [
    lang,
    PACKS.flatMap((pack) => DIFFICULTIES.flatMap((difficulty) => (LISTS[lang][pack]?.[difficulty] ?? []).map((raw) => entry(raw, difficulty, pack)))),
  ]),
);

export const counts = Object.fromEntries(LANGS.map((lang) => [lang, BUILT_IN[lang].length]));

/**
 * The host's words, from whatever they pasted: commas, semicolons or lines between words; letters,
 * spaces, hyphens and "|" for other answers; each at most 30 characters; no repeats.
 * @returns {string[]}
 */
export function parseCustom(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const piece of text.slice(0, CUSTOM_LIMITS.text).split(/[,;\n\r]+/)) {
    const raw = piece
      .normalize('NFC')
      .replace(/[^\p{L}\p{N} |-]/gu, '')
      .replace(/\s+/g, ' ')
      .split('|')
      .map((s) => s.trim().slice(0, CUSTOM_LIMITS.length).trim())
      .filter(Boolean)
      .join('|');
    const key = normalize(raw.split('|')[0]);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
    if (out.length >= CUSTOM_LIMITS.words) break;
  }
  return out;
}

/**
 * The words a game draws from.
 * @param {{ lang: string, packs: string[], difficulty: string, custom: string, onlyCustom: boolean }} settings
 * @returns {Entry[]}
 */
export function pool(settings) {
  const custom = parseCustom(settings.custom).map((raw) => entry(raw, 'medium', 'custom'));
  if (settings.onlyCustom) return custom;
  const packs = new Set(settings.packs);
  const builtIn = (BUILT_IN[settings.lang] ?? BUILT_IN.de).filter(
    (e) => packs.has(e.pack) && (settings.difficulty === 'mixed' || e.difficulty === settings.difficulty),
  );
  return [...builtIn, ...custom];
}

/** Two words as one, for combination mode: both have to be guessed. The harder one sets the points. */
export function combine(a, b) {
  const rank = (d) => DIFFICULTIES.indexOf(d);
  const difficulty = rank(a.difficulty) >= rank(b.difficulty) ? a.difficulty : b.difficulty;
  return { word: `${a.word} + ${b.word}`, answers: [], difficulty: difficulty === 'easy' ? 'medium' : 'hard', pack: a.pack, parts: [a, b] };
}

/**
 * The drawer's choices: `n` different words the game hasn't had yet (once the pool runs dry, any).
 * In combination mode each choice is two words.
 * @param {Entry[]} from  @param {number} n  @param {Set<string>} seen  @param {boolean} combo
 * @param {(n: number) => number} randomInt
 */
export function choices(from, n, seen, combo, randomInt) {
  const fresh = from.filter((e) => !seen.has(e.word));
  const source = fresh.length >= n * (combo ? 2 : 1) ? fresh : from;
  const picked = [];
  const used = new Set();
  const take = () => {
    for (let tries = 0; tries < 50; tries++) {
      const e = source[randomInt(source.length)];
      if (!used.has(e.word)) {
        used.add(e.word);
        return e;
      }
    }
    return source[randomInt(source.length)];
  };
  const want = Math.min(n, combo ? Math.floor(source.length / 2) : source.length);
  for (let i = 0; i < want; i++) picked.push(combo ? combine(take(), take()) : take());
  return picked;
}
