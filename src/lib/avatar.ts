// The avatars: five parts, each a short list of doodles, and a face drawn from five numbers
// (head, eyes, extra, mouth, colour: the maker's arrows, top to bottom). The wobble is seeded from
// those numbers, so every screen draws the same face. The server checks only the ranges
// (server/avatar.mjs → AVATAR_PARTS): keep the list lengths in step with it.

import { circ, paths, type Point, type Stroke } from './doodle';
import type { Key } from './i18n.svelte';

export type Avatar = [number, number, number, number, number];
/** A face's mood in the game: a right guess makes it happy for a moment. */
export type Mood = '' | 'happy';

const INK = '#1b1b1f';
const WHITE = '#ffffff';
const RED = '#e8442e';
const MAROON = '#8c1f2e';
const PINK = '#f06aa8';
const BROWN = '#8a5a3c';
const BLUE = '#2d5bd8';
const YELLOW = '#ffd23f';
const LIME = '#9bd84a';
const TAN = '#d9a86c';

const L = 38;
const R = 62;
const Y = 53;
const dot = (x: number, y: number, r: number, c = INK): Stroke => ({ p: circ(x, y, r, r * 1.1, 10), f: c, z: true, j: 0.5 });
const line = (p: Point[], w = 4, j = 0.5, c = INK): Stroke => ({ p, c, w, j });
const heart = (cx: number, cy: number, s: number): Stroke => ({
  p: [[cx, cy + s * 0.95], [cx - s, cy - s * 0.05], [cx - s * 0.9, cy - s * 0.7], [cx - s * 0.45, cy - s], [cx, cy - s * 0.55], [cx + s * 0.45, cy - s], [cx + s * 0.9, cy - s * 0.7], [cx + s, cy - s * 0.05]],
  f: RED,
  c: INK,
  w: 2,
  z: true,
  j: 0.4,
});
const smile = () => line([[37, 67], [44, 73], [56, 73], [63, 67]], 4, 0.7);

type Layers = { back?: Stroke[]; front?: Stroke[]; face?: Stroke[]; mouth?: Stroke[] };

export const COLORS: [Key, string][] = [
  ['av_rose', '#ffb3c7'], ['av_lime', LIME], ['av_yellow', YELLOW], ['av_sky', '#5aa9e6'], ['av_orange', '#ff9f43'], ['av_mint', '#b5ecd3'],
  ['av_peach', '#ffcfa6'], ['av_sand', TAN], ['av_grey', '#c4c8ce'], ['av_pink', PINK], ['av_teal', '#23b5a8'], ['av_white', WHITE],
];

export const TOPS: [Key, () => Layers][] = [
  ['av_none', () => ({})],
  ['av_curls', () => ({ front: [line([[20, 44], [24, 28], [33, 34], [37, 20], [47, 30], [54, 16], [61, 30], [69, 20], [73, 34], [81, 30], [80, 44]], 4, 1.2)] })],
  ['av_spikes', () => ({ front: [line([[23, 38], [27, 17], [38, 31], [46, 11], [54, 29], [64, 13], [70, 31], [79, 19], [78, 40]], 4, 1)] })],
  ['av_cap', () => ({ front: [{ p: [[19, 42], [21, 26], [40, 15], [62, 15], [79, 27], [81, 42]], f: BLUE, c: INK, w: 4, z: true, j: 1 }, line([[70, 40], [95, 42]], 5, 0.8)] })],
  ['av_bow', () => ({ front: [{ p: [[64, 24], [76, 16], [76, 32]], f: PINK, c: INK, w: 3, z: true, j: 0.7 }, { p: [[64, 24], [52, 16], [52, 32]], f: PINK, c: INK, w: 3, z: true, j: 0.7 }, dot(64, 24, 2.6)] })],
  ['av_beanie', () => ({ front: [{ p: [[18, 44], [20, 30], [32, 18], [50, 13], [68, 18], [80, 30], [82, 44]], f: RED, c: INK, w: 3.6, z: true, j: 0.9 }, { p: [[17, 36], [83, 36], [83, 44], [17, 44]], f: MAROON, c: INK, w: 3.2, z: true, j: 0.7 }, { p: circ(50, 10, 7, 7, 12), f: WHITE, c: INK, w: 3, z: true, j: 0.6 }] })],
  ['av_party', () => ({ front: [{ p: [[38, 30], [58, 3], [72, 34]], f: YELLOW, c: INK, w: 3.4, z: true, j: 0.6 }, line([[45, 22], [65, 23]], 3.4, 0.4, PINK), line([[52, 12], [61, 12]], 3, 0.3, BLUE), { p: circ(58, 4, 4.5, 4.5, 10), f: PINK, c: INK, w: 2.5, z: true, j: 0.4 }] })],
  ['av_mohawk', () => ({ front: [{ p: [[36, 30], [38, 16], [44, 20], [46, 6], [52, 17], [56, 6], [60, 19], [64, 12], [66, 30]], f: PINK, c: INK, w: 3, z: true, j: 0.5 }] })],
  ['av_bun', () => ({ back: [{ p: circ(50, 19, 12, 10, 14), f: BROWN, c: INK, w: 3.4, z: true, j: 0.6 }], front: [{ p: [[18, 50], [22, 33], [35, 25], [50, 23], [65, 25], [78, 33], [82, 50], [72, 40], [50, 35], [28, 40]], f: BROWN, c: INK, w: 3.2, z: true, j: 0.6 }] })],
  ['av_boppers', () => ({ back: [line([[42, 28], [33, 9]], 3), line([[58, 28], [67, 9]], 3)], front: [{ p: circ(32, 8, 5.5, 5.5, 10), f: LIME, c: INK, w: 2.6, z: true, j: 0.4 }, { p: circ(68, 8, 5.5, 5.5, 10), f: PINK, c: INK, w: 2.6, z: true, j: 0.4 }] })],
];

export const EYES: [Key, () => Stroke[]][] = [
  ['av_dots', () => [dot(L, Y, 4), dot(R, Y, 4)]],
  ['av_happy', () => [line([[L - 6, Y + 3], [L, Y - 4], [L + 6, Y + 3]]), line([[R - 6, Y + 3], [R, Y - 4], [R + 6, Y + 3]])]],
  ['av_big', () => [L, R].flatMap((x) => [{ p: circ(x, Y, 8, 8.5, 14), f: WHITE, c: INK, w: 3, z: true, j: 0.6 }, dot(x + 2, Y + 1, 3.4)])],
  ['av_wink', () => [dot(L, Y, 4), line([[R - 6, Y], [R + 6, Y]])]],
  ['av_sleepy', () => [L, R].flatMap((x) => [line([[x - 7, Y - 1], [x + 7, Y - 1]], 3.4, 0.4), { p: [[x - 5, Y - 1], [x - 3, Y + 3], [x + 3, Y + 3], [x + 5, Y - 1]], f: INK, z: true, j: 0.3 }])],
  ['av_dizzy', () => [L, R].flatMap((x) => [line([[x - 5, Y - 5], [x + 5, Y + 5]], 3.6), line([[x + 5, Y - 5], [x - 5, Y + 5]], 3.6)])],
  ['av_grumpy', () => [dot(L, Y + 1, 3.6), dot(R, Y + 1, 3.6), line([[L - 8, Y - 10], [L + 6, Y - 5]], 3.6), line([[R + 8, Y - 10], [R - 6, Y - 5]], 3.6)]],
  ['av_side', () => [L, R].flatMap((x) => [{ p: circ(x, Y, 8, 8.5, 14), f: WHITE, c: INK, w: 3, z: true, j: 0.6 }, dot(x + 4, Y, 3.2)])],
  ['av_hearts', () => [heart(L, Y, 6.5), heart(R, Y, 6.5)]],
  ['av_squint', () => [line([[L - 6, Y - 5], [L + 5, Y], [L - 6, Y + 5]], 3.8), line([[R + 6, Y - 5], [R - 5, Y], [R + 6, Y + 5]], 3.8)]],
];

export const EXTRAS: [Key, () => Layers][] = [
  ['av_none', () => ({})],
  ['av_glasses', () => ({ face: [{ p: circ(L, Y, 9.5, 9, 14), c: INK, w: 3.4, z: true, j: 0.6 }, { p: circ(R, Y, 9.5, 9, 14), c: INK, w: 3.4, z: true, j: 0.6 }, line([[47.5, 52], [52.5, 52]], 3.4, 0.3)] })],
  ['av_shades', () => ({ face: [{ p: [[26, 46], [47, 46], [45, 59], [29, 59]], f: INK, z: true, j: 0.6 }, { p: [[53, 46], [74, 46], [71, 59], [55, 59]], f: INK, z: true, j: 0.6 }, line([[46, 48], [54, 48]], 3, 0.3), line([[31, 50], [36, 49]], 2.2, 0.2, WHITE), line([[58, 50], [63, 49]], 2.2, 0.2, WHITE)] })],
  ['av_beard', () => ({ mouth: [line([[26, 66], [31, 80], [39, 73], [45, 87], [52, 74], [59, 86], [66, 72], [73, 80], [76, 64]], 3.4, 1, BROWN)] })],
  ['av_moustache', () => ({ mouth: [{ p: [[37, 66], [43, 61], [50, 64], [57, 61], [63, 66], [57, 66], [50, 67], [43, 66]], f: BROWN, c: INK, w: 2.4, z: true, j: 0.4 }] })],
  ['av_freckles', () => ({ face: ([[30, 62], [34, 65], [28, 67], [70, 62], [66, 65], [72, 67]] as Point[]).map(([x, y]) => dot(x, y, 1.5, BROWN)) })],
  ['av_blush', () => ({ face: [{ p: circ(29, 64, 6, 3.6, 12), f: PINK, o: 0.5, z: true, j: 0.4 }, { p: circ(71, 64, 6, 3.6, 12), f: PINK, o: 0.5, z: true, j: 0.4 }] })],
  ['av_plaster', () => ({ face: [{ p: [[62, 67], [76, 61], [78, 66], [64, 72]], f: TAN, c: INK, w: 2.2, z: true, j: 0.3 }, line([[69, 64], [71, 68]], 1.6, 0.1)] })],
];

export const MOUTHS: [Key, () => Stroke[]][] = [
  ['av_smile', () => [smile()]],
  ['av_grin', () => [{ p: [[35, 65], [65, 65], [59, 77], [50, 80], [41, 77]], f: WHITE, c: INK, w: 3.6, z: true, j: 0.7 }]],
  ['av_oh', () => [{ p: circ(50, 71, 5, 6, 10), f: INK, z: true, j: 0.5 }]],
  ['av_flat', () => [line([[40, 71], [60, 70]])]],
  ['av_tongue', () => [{ p: [[45, 72], [45, 79], [50, 83], [55, 79], [55, 72]], f: PINK, c: INK, w: 3, z: true, j: 0.4 }, smile()]],
  ['av_teeth', () => [{ p: [[45, 72], [49, 72], [49, 78], [45, 78]], f: WHITE, c: INK, w: 2.6, z: true, j: 0.3 }, { p: [[51, 72], [55, 72], [55, 78], [51, 78]], f: WHITE, c: INK, w: 2.6, z: true, j: 0.3 }, smile()]],
  ['av_wavy', () => [line([[36, 70], [41, 67], [46, 71], [51, 67], [56, 71], [61, 67], [64, 70]], 3.6)]],
  ['av_cat', () => [line([[38, 67], [44, 73], [50, 68], [56, 73], [62, 67]], 3.6)]],
  ['av_smirk', () => [line([[39, 72], [52, 72], [62, 65]])]],
  ['av_laugh', () => [{ p: [[34, 64], [66, 64], [62, 76], [50, 83], [38, 76]], f: MAROON, c: INK, w: 3.6, z: true, j: 0.6 }, { p: [[42, 77], [50, 73], [58, 77], [50, 81]], f: PINK, z: true, j: 0.4 }]],
];

/** The parts in the arrows' order, with how many choices each has. */
export const PARTS: { key: Key; size: number }[] = [
  { key: 'av_part_top', size: TOPS.length },
  { key: 'av_part_eyes', size: EYES.length },
  { key: 'av_part_extra', size: EXTRAS.length },
  { key: 'av_part_mouth', size: MOUTHS.length },
  { key: 'av_part_color', size: COLORS.length },
];

export const optionName = (part: number, index: number): Key => [TOPS, EYES, EXTRAS, MOUTHS, COLORS][part][index][0];

/** The winner's crown on the podium: not a head option, so it stays the winner's. */
const CROWN: Stroke[] = [{ p: [[30, 26], [32, 6], [42, 16], [50, 2], [58, 16], [68, 6], [70, 26]], f: YELLOW, c: INK, w: 3, z: true, j: 0.5 }, dot(50, 8, 2.4, RED)];

export function seedOf(a: Avatar) {
  return (((a[4] * 31 + a[1]) * 31 + a[3]) * 31 + a[0]) * 31 + a[2] + 11;
}

export function isAvatar(value: unknown): value is Avatar {
  return Array.isArray(value) && value.length === PARTS.length && value.every((v, i) => Number.isInteger(v) && v >= 0 && v < PARTS[i].size);
}

export function randomAvatar(): Avatar {
  return PARTS.map((p) => Math.floor(Math.random() * p.size)) as Avatar;
}

/**
 * The face as SVG markup. `frame` 1 and 2 are the same face redrawn with another wobble (the
 * maker's boil); a happy mood swaps in laughing eyes and mouth.
 */
export function avatarSvg(a: Avatar, { frame = 0, mood = '' as Mood, crown = false } = {}) {
  const [top, eyes, extra, mouth, color] = a;
  const t = TOPS[top]?.[1]() ?? {};
  const x = EXTRAS[extra]?.[1]() ?? {};
  const strokes: Stroke[] = [
    ...(t.back ?? []),
    { p: circ(50, 56, 33, 31, 22), f: COLORS[color]?.[1] ?? WHITE, c: INK, w: 4, z: true, j: 2.2 },
    ...(t.front ?? []),
    // The sunglasses cover the eyes.
    ...(extra === 2 ? [] : EYES[mood === 'happy' ? 1 : eyes]?.[1]() ?? []),
    ...(x.face ?? []),
    ...(MOUTHS[mood === 'happy' ? 9 : mouth]?.[1]() ?? []),
    ...(x.mouth ?? []),
    ...(crown ? CROWN : []),
  ];
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${paths(strokes, seedOf(a) * 3 + frame)}</svg>`;
}
