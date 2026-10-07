// A drawing's timelapse as an animated GIF, made in the browser: frames painted with the game's own
// painter (lib/ink.ts), each pixel mapped to the palette's nearest colour (the 24 colours fit a
// 32-entry colour table), LZW-compressed and written as GIF89a that loops. No dependencies.

import { duration, firstInk, H, PALETTE, paintAll, W, type Action } from './ink';

const SIZE = 32;

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TABLE: [number, number, number][] = Array.from({ length: SIZE }, (_, i) => (i < PALETTE.length ? rgb(PALETTE[i]) : [0, 0, 0]));

/** Each pixel's palette index; soft edges go to the nearest colour (cached per RGB). */
function indexed(data: Uint8ClampedArray, cache: Map<number, number>) {
  const out = new Uint8Array(data.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let best = cache.get(key);
    if (best === undefined) {
      let dist = Infinity;
      best = 0;
      for (let k = 0; k < PALETTE.length; k++) {
        const [pr, pg, pb] = TABLE[k];
        const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (d < dist) {
          dist = d;
          best = k;
        }
      }
      cache.set(key, best);
    }
    out[i] = best;
  }
  return out;
}

/** GIF's LZW, variable code width from minCode + 1 up to 12 bits, packed LSB first. */
function lzw(minCode: number, pixels: Uint8Array) {
  const clear = 1 << minCode;
  const end = clear + 1;
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  let width = minCode + 1;
  let next = end + 1;
  let dict = new Map<number, number>();
  const put = (code: number) => {
    acc |= code << bits;
    bits += width;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>>= 8;
      bits -= 8;
    }
  };
  put(clear);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    put(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << width && width < 12) width++;
    } else {
      put(clear);
      dict = new Map();
      next = end + 1;
      width = minCode + 1;
    }
    prefix = k;
  }
  put(prefix);
  put(end);
  if (bits > 0) bytes.push(acc & 255);
  return bytes;
}

function word(out: number[], n: number) {
  out.push(n & 255, (n >> 8) & 255);
}

/**
 * The drawing replayed from its first line in `frames` steps (the last one held), `width` pixels wide.
 * @returns the GIF's bytes
 */
export function timelapseGif(actions: Action[], { width = 400, frames = 24, delay = 12, hold = 150 } = {}) {
  const height = Math.round((width * H) / W);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(width / W, 0, 0, height / H, 0, 0);
  const first = firstInk(actions);
  const span = Math.max(1, duration(actions) - first);
  const cache = new Map<number, number>();
  const out: number[] = [];
  for (const ch of 'GIF89a') out.push(ch.charCodeAt(0));
  word(out, width);
  word(out, height);
  // A global colour table of 32 entries (size field 4: 2^(4+1)).
  out.push(0x80 | 0x70 | 4, 0, 0);
  for (const [r, g, b] of TABLE) out.push(r, g, b);
  // Loop for ever (NETSCAPE2.0).
  out.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0);
  for (let f = 1; f <= frames; f++) {
    ctx.setTransform(width / W, 0, 0, height / H, 0, 0);
    paintAll(ctx, actions, first + (span * f) / frames);
    const pixels = indexed(ctx.getImageData(0, 0, width, height).data, cache);
    // Graphic control: this frame's delay in hundredths of a second.
    out.push(0x21, 0xf9, 0x04, 0x00);
    word(out, f === frames ? hold : delay);
    out.push(0, 0);
    // The image, the whole canvas, no local colour table.
    out.push(0x2c);
    word(out, 0);
    word(out, 0);
    word(out, width);
    word(out, height);
    out.push(0);
    out.push(5);
    const data = lzw(5, pixels);
    for (let i = 0; i < data.length; i += 255) {
      const block = data.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
