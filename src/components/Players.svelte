<!--
  Who's playing, by score: a list beside the canvas on a wide screen, a strip under it on a phone.
  The drawer has the pencil, whoever has the word a tick; a right guess makes their face laugh and
  hop for a moment, and at a turn's end everyone's points show.
-->
<script lang="ts">
  import type { View } from '../lib/api';
  import { num, t } from '../lib/i18n.svelte';
  import Avatar from './Avatar.svelte';

  let { view, strip = false }: { view: View; strip?: boolean } = $props();

  let happy: Set<string> = $state(new Set());
  let before = new Set<string>();

  const ranked = $derived([...view.players].sort((a, b) => b.score - a.score));
  const drawer = $derived(view.turn?.drawer ?? null);

  $effect(() => {
    const now = new Set(view.players.filter((p) => p.guessed).map((p) => p.id));
    const fresh = [...now].filter((id) => !before.has(id));
    before = now;
    if (!fresh.length) return;
    happy = new Set([...happy, ...fresh]);
    setTimeout(() => (happy = new Set([...happy].filter((id) => !fresh.includes(id)))), 1800);
  });
</script>

<ol class="players" class:strip>
  {#each ranked as p, i (p.id)}
    <li class:me={p.id === view.me} class:got={p.guessed} class:off={!p.online} class:drawer={p.id === drawer}>
      <span class="face" class:hop={happy.has(p.id)}>
        <Avatar avatar={p.avatar} size={strip ? 36 : 40} mood={happy.has(p.id) ? 'happy' : ''} />
        {#if p.id === drawer}
          <span class="badge pen" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z" /></svg></span>
        {:else if p.guessed}
          <span class="badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" /></svg></span>
        {/if}
      </span>
      <span class="who">
        <span class="name">{#if !strip}<span class="rank">{i + 1}.</span>{/if}{p.name}{#if p.id === view.me}<span class="you">{` (${t('you')})`}</span>{/if}</span>
        <span class="score">{num(p.score)}{#if p.points !== null && p.points > 0}<span class="plus">+{num(p.points)}</span>{/if}</span>
      </span>
    </li>
  {/each}
</ol>

<style>
  .players {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 10px 4px 9px 5px / 5px 9px 4px 10px;
  }
  li.got {
    background: var(--hi-soft);
  }
  li.me {
    box-shadow: inset 0 0 0 1.5px rgb(43 45 51 / 0.35);
  }
  li.off {
    opacity: 0.5;
  }
  .face {
    position: relative;
    display: inline-grid;
    flex: none;
  }
  .hop {
    animation: hop 0.5s ease-out;
  }
  @keyframes hop {
    35% {
      transform: translateY(-8px) rotate(-4deg);
    }
    70% {
      transform: translateY(0) rotate(1deg);
    }
  }
  .badge {
    position: absolute;
    top: -4px;
    right: -6px;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--hi);
    box-shadow: 0 0 0 1.5px var(--ink);
  }
  .badge.pen {
    background: var(--tape);
  }
  .badge svg {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: var(--ink);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 14px/1.25 var(--ewo-sans);
  }
  .rank {
    margin-right: 4px;
    color: var(--mute);
    font-variant-numeric: tabular-nums;
  }
  .you {
    color: var(--mute);
    font-weight: 500;
  }
  .score {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font: 600 12.5px/1.2 var(--ewo-mono);
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .plus {
    padding: 0 5px;
    border-radius: 5px;
    background: var(--hi);
    color: var(--hi-ink);
  }

  /* The phone's strip: faces in a row that scrolls sideways. */
  .strip {
    flex-direction: row;
    gap: 4px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    padding: 4px 2px;
    contain: paint;
  }
  .strip::-webkit-scrollbar {
    display: none;
  }
  .strip li {
    flex-direction: column;
    gap: 3px;
    min-width: 58px;
    max-width: 72px;
    padding: 4px 3px;
    text-align: center;
  }
  .strip .who {
    align-items: center;
  }
  .strip .name {
    max-width: 66px;
    font-size: 12px;
  }
  .strip .you {
    display: none;
  }
  .strip .score {
    flex-direction: column;
    align-items: center;
    gap: 1px;
    font-size: 11px;
  }
</style>
