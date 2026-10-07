// The drawing on the page: the same operations the server keeps (server/ink.mjs), rendered on a
// 2D canvas at the device's pixel ratio over the fixed 800 × 600 canvas.
//
// Three users: the drawer's page draws as the pen moves and computes fills; the guessers' pages
// play the drawer's ink back on its own timing (Playback); the gallery renders whole drawings
// into thumbnails, timelapses and PNGs (render).

export const W = 800;
export const H = 600;
export const FW = 400;
export const FH = 300;
/** Pen widths in canvas units, thinnest first (server/ink.mjs → SIZES). */
export const SIZES = [4, 9, 16, 28, 44];
/** The palette: 24 fixed colours, the same on every screen (server/ink.mjs → PALETTE_SIZE). */
export const PALETTE = [
  '#1b1b1f', '#6b7078', '#c4c8ce', '#ffffff', '#e8442e', '#ff9f43', '#ffd23f', '#9bd84a', '#2fa35a', '#23b5a8', '#5aa9e6', '#2d5bd8',
  '#1d2f6b', '#7a4fd6', '#f06aa8', '#ffb3c7', '#8a5a3c', '#d9a86c', '#ffcfa6', '#b5ecd3', '#1f5f3f', '#8c1f2e', '#c9a227', '#f2c9a0',
];
/** The paper; the eraser paints with it, so fills still stop at erased edges. */
export const PAPER = 3;

export type Op = (string | number | number[])[];
type Fill = { k: 'f'; c: number; rle: number[]; t: number; img?: HTMLCanvasElement };
type StrokeAction = { k: 's'; id: number; c: number; w: number; pts: number[] };
export type Action = StrokeAction | Fill | { k: 'x'; t: number };

/** Applies one op to a list of actions (no drawing). Returns what changed, for incremental paint. */
export function applyOp(actions: Action[], op: Op): { kind: 'stroke' | 'points' | 'fill' | 'clear' | 'undo' | 'none'; from?: number } {
  switch (op[0]) {
    case 's':
      actions.push({ k: 's', id: op[1] as number, c: op[2] as number, w: op[3] as number, pts: [op[4] as number, op[5] as number, op[6] as number] });
      return { kind: 'stroke' };
    case 'p': {
      const last = actions.at(-1);
      if (last?.k !== 's' || last.id !== op[1]) return { kind: 'none' };
      const from = last.pts.length / 3;
      for (let i = 2; i + 2 < op.length; i += 3) last.pts.push(op[i] as number, op[i + 1] as number, op[i + 2] as number);
      return { kind: 'points', from };
    }
    case 'f':
      actions.push({ k: 'f', c: op[1] as number, rle: op[2] as number[], t: op[3] as number });
      return { kind: 'fill' };
    case 'x':
      actions.push({ k: 'x', t: op[1] as number });
      return { kind: 'clear' };
    case 'u':
      if (!actions.length) return { kind: 'none' };
      actions.pop();
      return { kind: 'undo' };
    default:
      return { kind: 'none' };
  }
}

/** The ops as actions, all at once (the gallery, a page that arrives late). */
export function toActions(ops: Op[]): Action[] {
  const actions: Action[] = [];
  for (const op of ops) applyOp(actions, op);
  return actions;
}

/** The time of an op in ms after the drawing started (undo has none). */
export function opTime(op: Op): number | null {
  switch (op[0]) {
    case 's':
      return op[6] as number;
    case 'f':
      return op[3] as number;
    case 'x':
      return op[1] as number;
    default:
      return null;
  }
}

// ---- painting ------------------------------------------------------------------------------

function strokeStyle(ctx: CanvasRenderingContext2D, a: StrokeAction) {
  ctx.strokeStyle = PALETTE[a.c] ?? PALETTE[0];
  ctx.fillStyle = ctx.strokeStyle;
  ctx.lineWidth = SIZES[a.w] ?? SIZES[1];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

/** Points `from` to the end of a stroke (from 0: the whole stroke, a dot if it's one point). */
export function paintStroke(ctx: CanvasRenderingContext2D, a: StrokeAction, from = 0) {
  strokeStyle(ctx, a);
  const n = a.pts.length / 3;
  if (n === 1 || (from === 0 && n === 1)) {
    ctx.beginPath();
    ctx.arc(a.pts[0], a.pts[1], (SIZES[a.w] ?? 9) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const start = Math.max(0, from - 1);
  ctx.beginPath();
  ctx.moveTo(a.pts[start * 3], a.pts[start * 3 + 1]);
  for (let i = start + 1; i < n; i++) ctx.lineTo(a.pts[i * 3], a.pts[i * 3 + 1]);
  ctx.stroke();
}

function fillImage(a: Fill) {
  if (a.img) return a.img;
  const off = document.createElement('canvas');
  off.width = FW;
  off.height = FH;
  const octx = off.getContext('2d')!;
  const img = octx.createImageData(FW, FH);
  const [r, g, b] = rgb(PALETTE[a.c] ?? PALETTE[0]);
  let i = 0;
  let inside = false;
  for (const run of a.rle) {
    if (inside) {
      for (let k = i; k < i + run; k++) {
        img.data[k * 4] = r;
        img.data[k * 4 + 1] = g;
        img.data[k * 4 + 2] = b;
        img.data[k * 4 + 3] = 255;
      }
    }
    i += run;
    inside = !inside;
  }
  octx.putImageData(img, 0, 0);
  a.img = off;
  return off;
}

export function paintFill(ctx: CanvasRenderingContext2D, a: Fill) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fillImage(a), 0, 0, W, H);
}

function paper(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = PALETTE[PAPER];
  ctx.fillRect(0, 0, W, H);
}

/**
 * The whole drawing, from the last clear on, into a context already scaled to canvas units.
 * `until` (ms) stops at that moment of the drawing, for timelapses.
 */
export function paintAll(ctx: CanvasRenderingContext2D, actions: Action[], until = Infinity) {
  let start = 0;
  actions.forEach((a, i) => {
    if (a.k === 'x' && a.t <= until) start = i + 1;
  });
  paper(ctx);
  for (let i = start; i < actions.length; i++) {
    const a = actions[i];
    if (a.k === 's') {
      if (a.pts[2] > until) break;
      if (until === Infinity) paintStroke(ctx, a);
      else {
        let n = 0;
        while (n < a.pts.length / 3 && a.pts[n * 3 + 2] <= until) n++;
        paintStroke(ctx, { ...a, pts: a.pts.slice(0, n * 3) });
        if (n < a.pts.length / 3) break;
      }
    } else if (a.k === 'f') {
      if (a.t > until) break;
      paintFill(ctx, a);
    }
  }
}

/** How long a drawing took, in ms (its last point, fill or clear). */
export function duration(actions: Action[]) {
  let end = 0;
  for (const a of actions) end = Math.max(end, a.k === 's' ? a.pts[a.pts.length - 1] : a.t);
  return end;
}

/** A drawing on a new canvas of the given width (thumbnails, PNG downloads). */
export function render(actions: Action[], width: number, until = Infinity) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round((width * H) / W);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  paintAll(ctx, actions, until);
  return canvas;
}

// ---- the board on screen -------------------------------------------------------------------

/** The canvas on screen: keeps the actions and paints each op as it comes. */
export class Board {
  actions: Action[] = [];
  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;

  attach(canvas: HTMLCanvasElement) {
    this.#canvas = canvas;
    this.#ctx = canvas.getContext('2d');
    this.resize();
  }

  detach() {
    this.#canvas = null;
    this.#ctx = null;
  }

  /** Matches the canvas's pixels to its size on screen, then paints everything again. */
  resize() {
    const canvas = this.#canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round((rect.width * dpr * H) / W));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.redraw();
  }

  redraw() {
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) return;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    paintAll(ctx, this.actions);
  }

  reset(ops: Op[] = []) {
    this.actions = toActions(ops);
    this.redraw();
  }

  apply(op: Op) {
    const change = applyOp(this.actions, op);
    const ctx = this.#ctx;
    if (!ctx) return;
    const last = this.actions.at(-1);
    switch (change.kind) {
      case 'stroke':
        if (last?.k === 's') paintStroke(ctx, last);
        break;
      case 'points':
        if (last?.k === 's') paintStroke(ctx, last, change.from);
        break;
      case 'fill':
        if (last?.k === 'f') paintFill(ctx, last);
        break;
      case 'clear':
        paper(ctx);
        break;
      case 'undo':
        this.redraw();
        break;
    }
  }

  /** Canvas units under a point on screen. */
  toCanvas(clientX: number, clientY: number): [number, number] {
    const rect = this.#canvas!.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    return [Math.round(Math.min(W, Math.max(0, x))), Math.round(Math.min(H, Math.max(0, y)))];
  }

  /**
   * The region a fill at (x, y) covers, on the 400 × 300 fill grid, as run lengths (outside
   * first). Computed on this page's own rendering, which is why the region travels instead of
   * the click (server/ink.mjs). Null when the spot already has that colour.
   */
  fillRegion(x: number, y: number, color: number): number[] | null {
    const off = render(this.actions, FW);
    const data = off.getContext('2d')!.getImageData(0, 0, FW, FH).data;
    const sx = Math.min(FW - 1, Math.floor(x / 2));
    const sy = Math.min(FH - 1, Math.floor(y / 2));
    const s = (sy * FW + sx) * 4;
    const seed = [data[s], data[s + 1], data[s + 2]];
    const target = rgb(PALETTE[color]);
    if (Math.abs(seed[0] - target[0]) + Math.abs(seed[1] - target[1]) + Math.abs(seed[2] - target[2]) < 12) return null;
    const match = (i: number) => Math.abs(data[i * 4] - seed[0]) + Math.abs(data[i * 4 + 1] - seed[1]) + Math.abs(data[i * 4 + 2] - seed[2]) <= 96;
    const mask = new Uint8Array(FW * FH);
    const stack = [sy * FW + sx];
    mask[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const px = i % FW;
      const py = (i - px) / FW;
      for (const j of [px > 0 ? i - 1 : -1, px < FW - 1 ? i + 1 : -1, py > 0 ? i - FW : -1, py < FH - 1 ? i + FW : -1]) {
        if (j >= 0 && !mask[j] && match(j)) {
          mask[j] = 1;
          stack.push(j);
        }
      }
    }
    // One pixel more all round, so the fill tucks under the lines' soft edges.
    const grown = mask.slice();
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const px = i % FW;
      if (px > 0) grown[i - 1] = 1;
      if (px < FW - 1) grown[i + 1] = 1;
      if (i >= FW) grown[i - FW] = 1;
      if (i < mask.length - FW) grown[i + FW] = 1;
    }
    const rle: number[] = [];
    let inside = false;
    let run = 0;
    for (let i = 0; i < grown.length; i++) {
      if (Boolean(grown[i]) !== inside) {
        rle.push(run);
        run = 0;
        inside = !inside;
      }
      run++;
    }
    rle.push(run);
    return rle;
  }
}

// ---- playing the drawer's ink back ---------------------------------------------------------

/** How far behind the drawer the playback runs, to ride out uneven arrivals. */
const BUFFER = 120;
/** Further behind than this (a hidden tab, a slow network), it catches up at once. */
const LAG = 1000;

/** Plays incoming ops on the drawer's own timing, so guessers watch a line being drawn. */
export class Playback {
  #queue: { at: number; op: Op }[] = [];
  #base: number | null = null;
  #last = 0;
  #frame = 0;

  constructor(readonly board: Board) {}

  reset() {
    this.#queue = [];
    this.#base = null;
    this.#last = 0;
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
  }

  push(ops: Op[]) {
    for (const op of ops) {
      if (op[0] === 'p') {
        const id = op[1];
        for (let i = 2; i + 2 < op.length; i += 3) this.#at(op[i + 2] as number, ['p', id, op[i], op[i + 1], op[i + 2]]);
      } else this.#at(opTime(op), op);
    }
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#run);
  }

  #at(t: number | null, op: Op) {
    const now = performance.now();
    let at = t === null ? this.#last : (this.#base ??= now + BUFFER - t) + t;
    if (t !== null && at < now - LAG) {
      this.#base = now + BUFFER - t;
      at = this.#base + t;
    }
    at = Math.max(at, this.#last);
    this.#last = at;
    this.#queue.push({ at, op });
  }

  #run = () => {
    this.#frame = 0;
    const now = performance.now();
    let i = 0;
    while (i < this.#queue.length && this.#queue[i].at <= now) this.board.apply(this.#queue[i++].op);
    if (i) this.#queue.splice(0, i);
    if (this.#queue.length) this.#frame = requestAnimationFrame(this.#run);
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
