// The drawing as operations, never pictures (development/plans/kritzle.md → "Ink travels as
// operations"). The drawer's page draws at once and sends what it drew every ~50 ms; this module
// checks each operation, keeps the turn's drawing, and hands back what everyone else is sent.
//
// Coordinates are integers on a fixed 800 × 600 canvas; t is ms since the drawing started. Ops:
//
//   ['s', id, color, size, x, y, t]       a stroke starts (color: palette index, size: SIZES index)
//   ['p', id, x, y, t, x, y, t, …]        more points of stroke id (only the latest action grows)
//   ['f', color, rle, t]                  a fill: the drawer's region on the 400 × 300 fill grid,
//                                         run lengths alternating outside/inside, row by row
//   ['u']                                 undo the latest action (a stroke, a fill or a clear)
//   ['x', t]                              clear the canvas (undo brings it back)
//
// The fill travels as the region the drawer's page computed, not as the click: browsers
// antialias edges differently, so the same click would spread differently on WebKit and Blink.

export const W = 800;
export const H = 600;
export const FILL_W = 400;
export const FILL_H = 300;
/** Pen widths in canvas units, thinnest first (the dock's five sizes). */
export const SIZES = [4, 9, 16, 28, 44];
export const PALETTE_SIZE = 24;

export const INK_LIMITS = Object.freeze({
  actions: 3000,
  points: 60_000,
  strokePoints: 6000,
  rle: 40_000,
  /** Ops per request. */
  batch: 400,
});

/** @typedef {{ k: 's', id: number, c: number, w: number, pts: number[] } | { k: 'f', c: number, rle: number[], t: number } | { k: 'x', t: number }} Action */

export function newDrawing() {
  return { /** @type {Action[]} */ actions: [], points: 0 };
}

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const coord = (v, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(0, Math.round(v))) : null);
const time = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(3_600_000, Math.max(0, Math.round(v))) : 0);

/**
 * Applies the drawer's ops to the drawing. Anything malformed, or past the limits, is dropped.
 * @param {ReturnType<typeof newDrawing>} drawing  @param {unknown} ops
 * @returns {unknown[][]} the ops as accepted (cleaned), for everyone else
 */
export function applyOps(drawing, ops) {
  const accepted = [];
  if (!Array.isArray(ops)) return accepted;
  for (const op of ops.slice(0, INK_LIMITS.batch)) {
    if (!Array.isArray(op)) continue;
    const { actions } = drawing;
    const last = actions.at(-1);
    switch (op[0]) {
      case 's': {
        const id = int(op[1], 0, 1e9);
        const c = int(op[2], 0, PALETTE_SIZE - 1);
        const w = int(op[3], 0, SIZES.length - 1);
        const x = coord(op[4], W);
        const y = coord(op[5], H);
        if (id === null || c === null || w === null || x === null || y === null) break;
        if (actions.length >= INK_LIMITS.actions || drawing.points >= INK_LIMITS.points) break;
        const t = time(op[6]);
        actions.push({ k: 's', id, c, w, pts: [x, y, t] });
        drawing.points++;
        accepted.push(['s', id, c, w, x, y, t]);
        break;
      }
      case 'p': {
        const id = int(op[1], 0, 1e9);
        if (id === null || last?.k !== 's' || last.id !== id) break;
        const add = [];
        for (let i = 2; i + 2 < op.length; i += 3) {
          if (last.pts.length / 3 >= INK_LIMITS.strokePoints || drawing.points >= INK_LIMITS.points) break;
          const x = coord(op[i], W);
          const y = coord(op[i + 1], H);
          if (x === null || y === null) continue;
          const t = time(op[i + 2]);
          last.pts.push(x, y, t);
          add.push(x, y, t);
          drawing.points++;
        }
        if (add.length) accepted.push(['p', id, ...add]);
        break;
      }
      case 'f': {
        const c = int(op[1], 0, PALETTE_SIZE - 1);
        const rle = op[2];
        if (c === null || !validRle(rle) || actions.length >= INK_LIMITS.actions) break;
        const t = time(op[3]);
        actions.push({ k: 'f', c, rle: [...rle], t });
        accepted.push(['f', c, rle, t]);
        break;
      }
      case 'u': {
        if (!actions.length) break;
        const gone = actions.pop();
        if (gone?.k === 's') drawing.points -= gone.pts.length / 3;
        accepted.push(['u']);
        break;
      }
      case 'x': {
        if (actions.length >= INK_LIMITS.actions || !actions.length || last?.k === 'x') break;
        const t = time(op[1]);
        actions.push({ k: 'x', t });
        accepted.push(['x', t]);
        break;
      }
      default:
        break;
    }
  }
  return accepted;
}

/** Run lengths that cover the fill grid exactly. */
function validRle(rle) {
  if (!Array.isArray(rle) || !rle.length || rle.length > INK_LIMITS.rle) return false;
  let sum = 0;
  for (const n of rle) {
    if (!Number.isInteger(n) || n < 0) return false;
    sum += n;
  }
  return sum === FILL_W * FILL_H;
}

/** The whole drawing as ops, for a page that arrives late or comes back (and the gallery). */
export function toOps(drawing) {
  const ops = [];
  for (const a of drawing.actions) {
    if (a.k === 's') {
      ops.push(['s', a.id, a.c, a.w, a.pts[0], a.pts[1], a.pts[2]]);
      if (a.pts.length > 3) ops.push(['p', a.id, ...a.pts.slice(3)]);
    } else if (a.k === 'f') ops.push(['f', a.c, a.rle, a.t]);
    else ops.push(['x', a.t]);
  }
  return ops;
}
