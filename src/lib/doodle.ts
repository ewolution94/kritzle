// The doodle pen behind the avatars and the page's own drawings: points are spaced out, wobbled
// with a seeded random and smoothed into one path, so the same seed draws the same line on every
// screen (development/plans/kritzle/avatar.html is where it started).

export type Point = [number, number];

/** A stroke: points, a stroke colour and width, a fill, closed or not, and how much it wobbles. */
export interface Stroke {
  p: Point[];
  c?: string;
  w?: number;
  f?: string;
  o?: number;
  z?: boolean;
  j?: number;
}

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spaced(p: Point[], closed: boolean, step: number): Point[] {
  const out: Point[] = [];
  const n = p.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push(p[n - 1]);
  return out;
}

const fx = (p: Point) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

function pathD(p: Point[], closed: boolean) {
  const n = p.length;
  if (n === 2) return `M${fx(p[0])}L${fx(p[1])}`;
  if (closed) {
    let d = `M${fx(mid(p[n - 1], p[0]))}`;
    for (let i = 0; i < n; i++) d += `Q${fx(p[i])} ${fx(mid(p[i], p[(i + 1) % n]))}`;
    return `${d}Z`;
  }
  let d = `M${fx(p[0])}`;
  for (let i = 1; i < n - 1; i++) d += `Q${fx(p[i])} ${fx(mid(p[i], p[i + 1]))}`;
  return `${d}L${fx(p[n - 1])}`;
}

export function circ(cx: number, cy: number, rx: number, ry: number, n = 16): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as Point;
  });
}

/** The strokes as SVG paths (markup only: no script, safe under the CSP). */
export function paths(strokes: Stroke[], seed: number, step = 9) {
  const r = rng(seed);
  let s = '';
  for (const st of strokes) {
    const z = Boolean(st.z);
    const j = st.j ?? 1;
    const pts = spaced(st.p, z, step).map(([x, y]) => [x + (r() - 0.5) * j, y + (r() - 0.5) * j] as Point);
    const stroke = st.c ? ` stroke="${st.c}" stroke-width="${st.w}"` : '';
    const op = st.o ? ` fill-opacity="${st.o}"` : '';
    s += `<path d="${pathD(pts, z)}" fill="${st.f || 'none'}"${op}${stroke} stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return s;
}
