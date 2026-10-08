<!--
  The drawer's tools: pen, eraser, fill, five sizes, the 24 colours, undo, and clear (held for a
  moment, so a stray tap never wipes a drawing). On a keyboard: B, E, F, 1–5, Ctrl/Cmd+Z.
  It fits the canvas it sits under (Turn.svelte's size container): the phone's two full-width rows,
  two compact rows in the middle, or one row under a wide canvas.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Spice } from '../lib/api';
  import { t } from '../lib/i18n.svelte';
  import { INK_BUDGET, PALETTE, SIZES } from '../lib/ink';
  import type { Tool } from './Canvas.svelte';

  let {
    tool = $bindable('pen'),
    color = $bindable(0),
    size = $bindable(1),
    spice = null,
    palette = null,
    inkUsed = 0,
    onundo,
    onclear,
  }: {
    tool?: Tool;
    color?: number;
    size?: number;
    spice?: Spice | null;
    /** Würze "three colours": the only ones offered. */
    palette?: number[] | null;
    inkUsed?: number;
    onundo: () => void;
    onclear: () => void;
  } = $props();

  const colors = $derived(spice === 'three' && palette ? palette : PALETTE.map((_, i) => i));
  const noFill = $derived(spice === 'oneline');
  const inkLeft = $derived(Math.max(0, 1 - inkUsed / INK_BUDGET));

  // A colour Würze doesn't offer falls back to the first one it does.
  $effect(() => {
    if (!colors.includes(color)) color = colors[0];
    if (noFill && tool === 'fill') tool = 'pen';
  });

  let holding = $state(false);
  let holdTimer = 0;

  function holdStart(event: PointerEvent) {
    event.preventDefault();
    holding = true;
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => {
      holding = false;
      onclear();
    }, 650);
  }
  function holdEnd() {
    holding = false;
    clearTimeout(holdTimer);
  }

  function pickColor(i: number) {
    color = i;
    if (tool === 'eraser') tool = 'pen';
  }

  onMount(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        onundo();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const k = event.key.toLowerCase();
      if (k === 'b' || k === 'p') tool = 'pen';
      else if (k === 'e') tool = 'eraser';
      else if (k === 'f' || k === 'g') tool = 'fill';
      else if (/^[1-5]$/.test(k)) size = Number(k) - 1;
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });
</script>

<div class="dock box">
  <div class="tools">
    <button class="tool" type="button" aria-label={t('pen')} aria-pressed={tool === 'pen'} onclick={() => (tool = 'pen')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z" /><path d="M14 6l3 3" /></svg>
    </button>
    <button class="tool" type="button" aria-label={t('eraser')} aria-pressed={tool === 'eraser'} onclick={() => (tool = 'eraser')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 20h12" /><path d="M4 15l9-9 6 6-7 7H8z" /><path d="M9 10l6 6" /></svg>
    </button>
    <button class="tool" type="button" aria-label={t('fill')} aria-pressed={tool === 'fill'} disabled={noFill} onclick={() => (tool = 'fill')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11l7-7 7 7-7 7z" /><path d="M5 11h14" /><path d="M20 15c.8 1.3 1.5 2.4 1.5 3.2a1.5 1.5 0 01-3 0c0-.8.7-1.9 1.5-3.2z" /></svg>
    </button>
    <span class="sep" aria-hidden="true"></span>
    <button class="tool" type="button" aria-label={t('undo')} onclick={onundo}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 010 12h-3" /></svg>
    </button>
    <button
      disabled={noFill}
      class="tool clear"
      class:holding
      type="button"
      aria-label="{t('clear')} ({t('clearHold')})"
      title={t('clearHold')}
      onpointerdown={holdStart}
      onpointerup={holdEnd}
      onpointerleave={holdEnd}
      onpointercancel={holdEnd}
      onclick={(e) => {
        // A keyboard press (no pointer) clears at once.
        if (e.detail === 0) onclear();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></svg>
    </button>
    <div class="sizes" role="radiogroup" aria-label={t('size', { n: '' })}>
      {#each SIZES as px, i (i)}
        <button class="size" type="button" role="radio" aria-checked={size === i} aria-label={t('size', { n: i + 1 })} onclick={() => (size = i)}>
          <i style:width="{Math.max(4, Math.round(px / 2.2))}px" style:height="{Math.max(4, Math.round(px / 2.2))}px" style:background={tool === 'eraser' ? '#ffffff' : PALETTE[color]}></i>
        </button>
      {/each}
    </div>
  </div>
  <div class="palette" class:few={colors.length < PALETTE.length} role="radiogroup" aria-label={t('colorName', { n: '' })}>
    {#each colors as i (i)}
      <button class="swatch" type="button" role="radio" aria-checked={color === i && tool !== 'eraser'} aria-label={t('colorName', { n: i + 1 })} style:background={PALETTE[i]} onclick={() => pickColor(i)}></button>
    {/each}
  </div>
  {#if spice === 'ink'}
    <div class="ink" role="meter" aria-label={t('inkLeft')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(inkLeft * 100)}>
      <span style:transform="scaleX({inkLeft})"></span>
    </div>
  {/if}
</div>

<style>
  .dock {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 7px;
    user-select: none;
    -webkit-user-select: none;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .tool {
    display: grid;
    place-items: center;
    width: 36px;
    height: 38px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 10px 4px 9px 5px / 5px 9px 4px 10px;
    background: transparent;
    -webkit-tap-highlight-color: transparent;
  }
  .tool svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .tool[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--hi);
    color: var(--hi-ink);
  }
  @media (hover: hover) {
    .tool:hover {
      background: #f4ffd6;
    }
  }
  .clear {
    position: relative;
    overflow: hidden;
  }
  .clear::after {
    content: '';
    position: absolute;
    inset: auto 0 0 0;
    height: 0;
    background: rgb(179 38 30 / 0.25);
  }
  .clear.holding::after {
    height: 100%;
    transition: height 0.65s linear;
  }
  .sep {
    width: 1.5px;
    height: 24px;
    margin: 0 3px;
    background: rgb(43 45 51 / 0.2);
  }
  .sizes {
    display: flex;
    align-items: center;
    gap: 1px;
    margin-left: auto;
  }
  .size {
    display: grid;
    place-items: center;
    width: 28px;
    height: 38px;
    padding: 0;
    border: 0;
    background: none;
    -webkit-tap-highlight-color: transparent;
  }
  .size i {
    display: block;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(43 45 51 / 0.45);
  }
  .size[aria-checked='true'] i {
    box-shadow: 0 0 0 2px var(--card), 0 0 0 4px var(--ink);
  }
  .palette {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 40px));
    gap: 4px;
  }
  .palette.few {
    grid-template-columns: repeat(3, minmax(0, 56px));
  }
  .ink {
    height: 10px;
    border: 1.5px solid var(--ink);
    border-radius: 6px;
    overflow: hidden;
  }
  .ink span {
    display: block;
    height: 100%;
    background: var(--ink);
    transform-origin: left;
    transition: transform 0.15s linear;
  }
  .tool:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .swatch {
    aspect-ratio: 1;
    min-height: 20px;
    padding: 0;
    border: 0;
    border-radius: 6px;
    box-shadow: inset 0 0 0 1.5px rgb(0 0 0 / 0.22);
    -webkit-tap-highlight-color: transparent;
  }
  .swatch[aria-checked='true'] {
    outline: 2.5px solid var(--ink);
    outline-offset: 1.5px;
  }
  .tool:focus-visible,
  .size:focus-visible,
  .swatch:focus-visible {
    outline: 3px solid var(--tape-2);
    outline-offset: 1px;
  }
  /* Under a wider canvas: a compact box in the middle instead of rows stretched across it. */
  @container (min-width: 520px) {
    .dock {
      width: fit-content;
      max-width: 100%;
      margin-inline: auto;
    }
    .sizes {
      margin-left: 10px;
      padding-left: 10px;
      border-left: 1.5px solid rgb(43 45 51 / 0.2);
    }
    .palette {
      grid-template-columns: repeat(12, 28px);
    }
    .palette.few {
      grid-template-columns: repeat(3, 40px);
    }
  }
  /* Under a wide canvas: one row, the tools and sizes beside the colours. */
  @container (min-width: 780px) {
    .dock {
      flex-direction: row;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 14px;
      padding: 8px 12px;
    }
    .palette {
      padding-left: 14px;
      border-left: 1.5px solid rgb(43 45 51 / 0.2);
    }
    .ink {
      flex-basis: 100%;
    }
  }
  @media (max-width: 420px) {
    .tools {
      gap: 1px;
    }
    .tool {
      width: 33px;
    }
    .size {
      width: 24px;
    }
    .sep {
      margin: 0 2px;
    }
  }
</style>
