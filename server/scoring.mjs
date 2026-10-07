// Points, the plan's proposal (development/plans/kritzle.md → Scoring):
//
//   guesser  500 × (0.25 + 0.75 × time left / draw time), so 125 to 500; the first to guess +100,
//            the second +50
//   drawer   the guessers' average × the share of players who got it; nothing when nobody does
//   both     × 1, × 1.25 or × 1.5 for an easy, medium or hard word
//
// Hints cost nothing (skribbl.io's way).

export const MULTIPLIER = Object.freeze({ easy: 1, medium: 1.25, hard: 1.5 });
export const MAX_GUESS = 500;
const ORDER_BONUS = [100, 50];

/**
 * @param {{ left: number, total: number, order: number, difficulty: keyof typeof MULTIPLIER }} guess
 *   left and total in ms; order 0 for the first to guess
 */
export function guessPoints({ left, total, order, difficulty }) {
  const share = total > 0 ? Math.min(1, Math.max(0, left / total)) : 0;
  const base = MAX_GUESS * (0.25 + 0.75 * share) + (ORDER_BONUS[order] ?? 0);
  return Math.round(base * (MULTIPLIER[difficulty] ?? 1));
}

/**
 * @param {number[]} points  each guesser's points this turn
 * @param {number} possible  how many could have guessed (everyone but the drawer)
 */
export function drawerPoints(points, possible) {
  if (!points.length || possible <= 0) return 0;
  const average = points.reduce((sum, p) => sum + p, 0) / points.length;
  return Math.round(average * Math.min(1, points.length / possible));
}
