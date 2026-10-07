// A guess against the word. Compared normalised, so case, umlauts (ä = ae), ß = ss, accents,
// spaces and hyphens never decide; a word's aliases count too ("Handy|Smartphone"). "Close" is
// one edit away, two from eight letters on. Combination mode ("Hund + Hut") wants both words.

/** @typedef {{ word: string, answers: string[], difficulty: 'easy' | 'medium' | 'hard', pack: string, parts?: Entry[] }} Entry */

/** Lowercase letters and digits only, with ä→ae, ö→oe, ü→ue, ß→ss and accents dropped. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Edit distance, stopping early once it's over `max` (then it returns max + 1). */
export function distance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      // A swapped pair of letters ("Hunh" for "Huhn") counts as one edit.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

const near = (guess, answer) => guess.length >= 3 && distance(guess, answer, answer.length >= 8 ? 2 : 1) <= (answer.length >= 8 ? 2 : 1);

/**
 * How a chat message stands against the word.
 * @param {Entry} entry  @param {string} text
 * @returns {'right' | 'close' | 'half' | null}  half: one of a combination's two words
 */
export function judge(entry, text) {
  const guess = normalize(text);
  if (!guess) return null;
  if (entry.parts) {
    const hits = entry.parts.map((part) => part.answers.some((a) => guess.includes(a)));
    if (hits.every(Boolean)) return 'right';
    if (hits.some(Boolean)) return 'half';
    return entry.parts.some((part) => part.answers.some((a) => near(guess, a))) ? 'close' : null;
  }
  if (entry.answers.includes(guess)) return 'right';
  return entry.answers.some((a) => near(guess, a)) ? 'close' : null;
}

/** Positions of the letters (not spaces, hyphens or the combination's " + ") in a word. */
export function letterIndexes(word) {
  const out = [];
  [...word].forEach((ch, i) => {
    if (/\p{L}|\p{N}/u.test(ch)) out.push(i);
  });
  return out;
}

/**
 * The word as guessers see it: every letter a "_" unless revealed; spaces, hyphens and the
 * combination's "+" stay as they are.
 * @param {string} word  @param {Set<number>} revealed  indexes into [...word]
 */
export function pattern(word, revealed) {
  return [...word].map((ch, i) => (/\p{L}|\p{N}/u.test(ch) && !revealed.has(i) ? '_' : ch)).join('');
}

/**
 * The order hints uncover letters in: a random order of the word's letters, cut to at most half
 * of them, so a hint never gives the whole word away.
 * @param {string} word  @param {number} count  @param {() => number} random
 */
export function hintOrder(word, count, random = Math.random) {
  const letters = letterIndexes(word);
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters.slice(0, Math.min(count, Math.floor(letters.length / 2)));
}

/**
 * When the hints come, in ms after the drawing starts: spread evenly over the middle of the
 * draw time, sooner in Blitz.
 * @param {number} count  @param {number} ms  draw time  @param {boolean} blitz
 */
export function hintTimes(count, ms, blitz = false) {
  if (!count) return [];
  const from = blitz ? 0.2 : 0.35;
  const to = 0.85;
  return Array.from({ length: count }, (_, i) => Math.round(ms * (count === 1 ? (from + to) / 2 : from + ((to - from) * i) / (count - 1))));
}
