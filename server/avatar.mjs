// An avatar is five small numbers: head, eyes, extra, mouth, colour (the order of the maker's
// arrows, top to bottom). The page draws it with Folio's doodle emblem (src/lib/avatar.ts); the
// server only checks the ranges.

/** How many choices each part has: the doodle emblem's (tests/avatar.test.mjs checks they match). */
export const AVATAR_PARTS = Object.freeze([10, 10, 8, 10, 12]);

/** A valid avatar from whatever came in, or a random one. */
export function cleanAvatar(raw, random = Math.random) {
  if (Array.isArray(raw) && raw.length === AVATAR_PARTS.length && raw.every((v, i) => Number.isInteger(v) && v >= 0 && v < AVATAR_PARTS[i])) {
    return [...raw];
  }
  return randomAvatar(random);
}

export function randomAvatar(random = Math.random) {
  return AVATAR_PARTS.map((n) => Math.floor(random() * n));
}
