<!--
  The canvas. The drawer's pen draws here at once and goes to the server in small batches
  (Room.ink); everyone else plays the drawer's ink back on its own timing (lib/ink.ts → Playback),
  and a page that arrives late starts from the whole drawing. Reactions float up over it.

  Drawing on a phone is a real way to play: pointer capture, coalesced events where the browser
  has them, no scrolling, callout or selection on the canvas (touch-action: none), and the page's
  gutter keeps strokes away from Safari's edge-swipe back gesture.

  A team duel has a canvas per team (`team`). Würze changes the drawer's pen here: blind (the sheet
  wipes when the pen lifts), mirror (a mirrored copy follows each stroke), shaky (the hand trembles),
  one stroke, and the ink budget; the server holds the rules too (server/game.mjs → spiceFilter).
  Fälscher (`stroke`): one stroke in the player's own colour, then `onstroke`.
-->
<script lang="ts" module>
  export type Tool = 'pen' | 'eraser' | 'fill';
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { Spice, Turn } from '../lib/api';
  import { Board, INK_BUDGET, PAPER, Playback, W, type Op } from '../lib/ink';
  import type { Room } from '../lib/room.svelte';

  let {
    room,
    turn,
    team = null,
    drawing = false,
    tool = 'pen',
    color = 0,
    size = 1,
    spice = null,
    stroke = null,
    onstroke,
    oninkused,
    children,
  }: {
    room: Room;
    turn: Turn;
    team?: number | null;
    drawing?: boolean;
    tool?: Tool;
    color?: number;
    size?: number;
    spice?: Spice | null;
    /** Fälscher: this player's one stroke, in their colour. */
    stroke?: { color: number } | null;
    onstroke?: () => void;
    oninkused?: (points: number) => void;
    children?: Snippet;
  } = $props();

  const board = new Board();
  const playback = new Playback(board);
  let canvas: HTMLCanvasElement;
  let shown = 0;
  let active: number | null = null;
  let current: number[] = [];
  let currentColor = 0;
  let currentSize = 1;
  let seq = 0;
  let strokes = 0;
  /** Fälscher: strokes this player has drawn in this turn of theirs. */
  let mine = 0;
  let used = 0;
  let last: [number, number] = [0, 0];
  let floating: { id: number; e: string; x: number }[] = $state([]);
  let floatId = 0;

  /** The drawing's clock: ms since it started, on the server's time. */
  const elapsed = () => Math.max(0, Date.now() + room.offset - (turn.startsAt ?? Date.now()));

  function show(n: number) {
    shown = n;
    playback.reset();
    active = null;
    board.reset(room.drawingFor(n, team));
    seq = board.actions.length + 1;
    strokes = board.actions.filter((a) => a.k === 's').length;
    used = board.actions.reduce((sum, a) => sum + (a.k === 's' ? a.pts.length / 3 : 0), 0);
    oninkused?.(used);
  }

  // A new turn starts on a clean sheet (or on what's there, coming back mid-turn).
  $effect(() => {
    if (turn.n !== shown) show(turn.n);
  });

  // Fälscher: each turn of mine allows one new stroke.
  $effect(() => {
    if (drawing) mine = 0;
  });

  onMount(() => {
    board.attach(canvas);
    show(turn.n);
    const resize = new ResizeObserver(() => board.resize());
    resize.observe(canvas);
    const offInk = room.onInk((event) => {
      if ((event.team ?? null) !== team) return;
      if (event.turn !== shown) {
        if (event.kind === 'canvas') show(event.turn);
        return;
      }
      if (event.kind === 'canvas') {
        playback.reset();
        board.reset(event.ops);
        seq = Math.max(seq, board.actions.length + 1);
      } else playback.push(event.ops);
    });
    const offReact = room.onReact(({ e }) => {
      const id = ++floatId;
      floating = [...floating.slice(-12), { id, e: room.view?.reactions[e] ?? '', x: 8 + Math.random() * 78 }];
      setTimeout(() => (floating = floating.filter((f) => f.id !== id)), 1800);
    });
    return () => {
      resize.disconnect();
      offInk();
      offReact();
      playback.reset();
      board.detach();
    };
  });

  function emit(op: Op) {
    board.apply(op);
    room.ink(turn.n, [op], team);
  }

  function spend(points: number) {
    used += points;
    oninkused?.(used);
  }

  /** The dock's buttons and the keyboard. */
  export function undo() {
    if (!drawing || stroke || !board.actions.length) return;
    active = null;
    emit(['u']);
  }

  export function clear() {
    if (!drawing || stroke || spice === 'oneline' || !board.actions.length || board.actions.at(-1)?.k === 'x') return;
    active = null;
    emit(['x', elapsed()]);
  }

  /** Can the pen go down now? (Würze and Fälscher limit it.) */
  function allowed() {
    if (stroke) return mine === 0;
    if (spice === 'oneline' && strokes >= 1) return false;
    if (spice === 'ink' && used >= INK_BUDGET) return false;
    return true;
  }

  function down(event: PointerEvent) {
    if (!drawing || event.button > 0 || !allowed()) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer can't be captured (learnings/browser-testing.md); real ones can.
    }
    const [x, y] = board.toCanvas(event.clientX, event.clientY);
    if (tool === 'fill' && !stroke && spice !== 'oneline') {
      const rle = board.fillRegion(x, y, color);
      if (rle) emit(['f', color, rle, elapsed()]);
      return;
    }
    active = seq++;
    strokes++;
    mine++;
    last = [x, y];
    currentColor = stroke ? stroke.color : tool === 'eraser' ? PAPER : color;
    currentSize = stroke ? Math.min(size, 2) : size;
    const t = elapsed();
    current = [x, y, t];
    emit(['s', active, currentColor, currentSize, x, y, t]);
    spend(1);
  }

  function jitter(v: number) {
    return spice === 'shaky' ? v + Math.round((Math.random() - 0.5) * 10) : v;
  }

  function move(event: PointerEvent) {
    if (active === null) return;
    const events = event.getCoalescedEvents?.() ?? [];
    const pts: number[] = [];
    const t = elapsed();
    for (const e of events.length ? events : [event]) {
      if (spice === 'ink' && used + pts.length / 3 >= INK_BUDGET) break;
      const [x, y] = board.toCanvas(e.clientX, e.clientY);
      if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 2) continue;
      last = [x, y];
      pts.push(jitter(x), jitter(y), t);
    }
    if (!pts.length) return;
    current.push(...pts);
    emit(['p', active, ...pts]);
    spend(pts.length / 3);
  }

  function up() {
    if (active === null) return;
    active = null;
    if (spice === 'mirror' && current.length >= 3) {
      // The mirrored copy follows once the pen lifts (only the latest stroke can grow).
      const id = seq++;
      const m = current.map((v, i) => (i % 3 === 0 ? W - v : v));
      emit(['s', id, currentColor, currentSize, m[0], m[1], m[2]]);
      if (m.length > 3) emit(['p', id, ...m.slice(3)]);
    }
    current = [];
    if (spice === 'blind') board.blank();
    if (stroke) onstroke?.();
  }
</script>

<div class="sheet" class:drawing>
  <canvas
    bind:this={canvas}
    class:pen={drawing && tool !== 'fill'}
    class:bucket={drawing && tool === 'fill'}
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
    aria-label={drawing ? 'Canvas' : undefined}
  ></canvas>
  <div class="float" aria-hidden="true">
    {#each floating as f (f.id)}
      <span style:left="{f.x}%">{f.e}</span>
    {/each}
  </div>
  {@render children?.()}
</div>

<style>
  .sheet {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #ffffff;
    border-radius: 3px;
    box-shadow: 0 0 0 2px var(--ink), 3px 4px 0 2px rgb(43 45 51 / 0.12);
  }
  /* Two pieces of washi tape hold the sheet down. */
  .sheet::before,
  .sheet::after {
    content: '';
    position: absolute;
    z-index: 3;
    top: -9px;
    width: 52px;
    height: 17px;
    background: rgb(79 195 185 / 0.62);
    pointer-events: none;
  }
  .sheet::before {
    left: -12px;
    transform: rotate(-28deg);
  }
  .sheet::after {
    right: -12px;
    transform: rotate(28deg);
    background: rgb(255 143 112 / 0.7);
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 3px;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  canvas.pen {
    cursor: crosshair;
  }
  canvas.bucket {
    cursor: cell;
  }
  .float {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    z-index: 2;
  }
  .float span {
    position: absolute;
    bottom: 4px;
    font-size: 28px;
    animation: rise 1.8s ease-out forwards;
  }
  @keyframes rise {
    0% {
      transform: translateY(0) scale(0.6);
      opacity: 0;
    }
    15% {
      transform: translateY(-20px) scale(1.1);
      opacity: 1;
    }
    100% {
      transform: translateY(-220px) rotate(-12deg);
      opacity: 0;
    }
  }
</style>
