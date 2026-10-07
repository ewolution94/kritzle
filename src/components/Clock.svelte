<!-- The turn's clock: seconds left, and a ring that empties. Red for the last ten seconds. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';

  let { room, from, to }: { room: Room; from: number; to: number } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });

  const left = $derived(room.left(to, now));
  const total = $derived(Math.max(1, to - from));
  const seconds = $derived(Math.ceil(left / 1000));
  const share = $derived(Math.min(1, left / total));
</script>

<span class="clock" class:late={seconds <= 10} role="timer" aria-label={t('secondsLeft', { n: seconds })}>
  <svg viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="16" class="track" />
    <circle cx="20" cy="20" r="16" class="arc" pathLength="1" stroke-dasharray="{share} 1" />
  </svg>
  <span class="n">{seconds}</span>
</span>

<style>
  .clock {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 44px;
    height: 44px;
    flex: none;
  }
  svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
  }
  circle {
    fill: none;
    stroke-width: 4;
  }
  .track {
    stroke: rgb(43 45 51 / 0.12);
    fill: var(--card);
  }
  .arc {
    stroke: var(--ink);
    stroke-linecap: round;
    transition: stroke-dasharray 0.25s linear;
  }
  .late .arc {
    stroke: var(--bad);
  }
  .n {
    position: relative;
    font: 700 15px/1 var(--ewo-mono);
    font-variant-numeric: tabular-nums;
  }
  .late .n {
    color: var(--bad);
  }
</style>
