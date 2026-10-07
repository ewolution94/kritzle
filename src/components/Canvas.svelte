<!--
  The canvas. The drawer's pen draws here at once and goes to the server in small batches
  (Room.ink); everyone else plays the drawer's ink back on its own timing (lib/ink.ts → Playback),
  and a page that arrives late starts from the whole drawing. Reactions float up over it.

  Drawing on a phone is a real way to play: pointer capture, coalesced events where the browser
  has them, no scrolling, callout or selection on the canvas (touch-action: none), and the page's
  gutter keeps strokes away from Safari's edge-swipe back gesture.
-->
<script lang="ts" module>
  export type Tool = 'pen' | 'eraser' | 'fill';
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import type { Turn } from '../lib/api';
  import { Board, PAPER, Playback, type Op } from '../lib/ink';
  import type { Room } from '../lib/room.svelte';

  let {
    room,
    turn,
    drawing = false,
    tool = 'pen',
    color = 0,
    size = 1,
    children,
  }: { room: Room; turn: Turn; drawing?: boolean; tool?: Tool; color?: number; size?: number; children?: Snippet } = $props();

  const board = new Board();
  const playback = new Playback(board);
  let canvas: HTMLCanvasElement;
  let shown = 0;
  let stroke: number | null = null;
  let seq = 0;
  let last: [number, number] = [0, 0];
  let floating: { id: number; e: string; x: number }[] = $state([]);
  let floatId = 0;

  /** The drawing's clock: ms since it started, on the server's time. */
  const elapsed = () => Math.max(0, Date.now() + room.offset - (turn.startsAt ?? Date.now()));

  function show(n: number) {
    shown = n;
    playback.reset();
    stroke = null;
    board.reset(room.drawing.turn === n ? room.drawing.ops : []);
    seq = board.actions.length + 1;
  }

  // A new turn starts on a clean sheet (or on what's there, coming back mid-turn).
  $effect(() => {
    if (turn.n !== shown) show(turn.n);
  });

  onMount(() => {
    board.attach(canvas);
    show(turn.n);
    const resize = new ResizeObserver(() => board.resize());
    resize.observe(canvas);
    const offInk = room.onInk((event) => {
      if (event.turn !== shown) {
        if (event.kind === 'canvas') show(event.turn);
        return;
      }
      if (event.kind === 'canvas') {
        playback.reset();
        board.reset(event.ops);
        seq = Math.max(seq, board.actions.length + 1);
      } else if (!drawing) playback.push(event.ops);
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
    room.ink(turn.n, [op]);
  }

  /** The dock's buttons and the keyboard. */
  export function undo() {
    if (!drawing || !board.actions.length) return;
    stroke = null;
    emit(['u']);
  }

  export function clear() {
    if (!drawing || !board.actions.length || board.actions.at(-1)?.k === 'x') return;
    stroke = null;
    emit(['x', elapsed()]);
  }

  function down(event: PointerEvent) {
    if (!drawing || event.button > 0) return;
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer can't be captured (learnings/browser-testing.md); real ones can.
    }
    const [x, y] = board.toCanvas(event.clientX, event.clientY);
    if (tool === 'fill') {
      const rle = board.fillRegion(x, y, color);
      if (rle) emit(['f', color, rle, elapsed()]);
      return;
    }
    stroke = seq++;
    last = [x, y];
    emit(['s', stroke, tool === 'eraser' ? PAPER : color, size, x, y, elapsed()]);
  }

  function move(event: PointerEvent) {
    if (stroke === null) return;
    const events = event.getCoalescedEvents?.() ?? [];
    const pts: number[] = [];
    const t = elapsed();
    for (const e of events.length ? events : [event]) {
      const [x, y] = board.toCanvas(e.clientX, e.clientY);
      if (Math.abs(x - last[0]) + Math.abs(y - last[1]) < 2) continue;
      last = [x, y];
      pts.push(x, y, t);
    }
    if (pts.length) emit(['p', stroke, ...pts]);
  }

  function up() {
    stroke = null;
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
