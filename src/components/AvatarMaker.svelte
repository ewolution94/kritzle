<!--
  The avatar maker, like skribbl.io's (development/plans/kritzle/avatar.html): arrows on either
  side of a big doodle face, one pair per part, top to bottom as the parts sit (head, eyes, extra,
  mouth, colour), and a dice for all five. A tap shows the part's new choice on a strip of tape.
-->
<script lang="ts">
  import { PARTS, optionName, type Avatar as AvatarValue } from '../lib/avatar';
  import { t } from '../lib/i18n.svelte';
  import Avatar from './Avatar.svelte';

  let { avatar, onchange }: { avatar: AvatarValue; onchange: (next: AvatarValue) => void } = $props();

  let tag = $state('');
  let showTag = $state(false);
  let hop = $state(0);
  let rolling = $state(false);
  let tagTimer = 0;

  function announce(text: string) {
    tag = text;
    showTag = true;
    clearTimeout(tagTimer);
    tagTimer = window.setTimeout(() => (showTag = false), 1100);
  }

  function step(part: number, delta: number) {
    const next = [...avatar] as AvatarValue;
    const size = PARTS[part].size;
    next[part] = (next[part] + delta + size) % size;
    onchange(next);
    announce(`${t(PARTS[part].key)} · ${t(optionName(part, next[part]))}`);
  }

  function roll() {
    const next = PARTS.map((p) => Math.floor(Math.random() * p.size)) as AvatarValue;
    onchange(next);
    hop++;
    rolling = false;
    requestAnimationFrame(() => (rolling = true));
    announce(t('avRolled'));
  }
</script>

<div class="maker">
  <div class="col">
    {#each PARTS as part, i (part.key)}
      <button class="arrow" type="button" aria-label={t('avPrev', { part: t(part.key) })} onclick={() => step(i, -1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
    {/each}
  </div>
  <div class="stage">
    {#key hop}
      <div class="face" class:hop={hop > 0}>
        <Avatar {avatar} size={200} boil ring={false} />
      </div>
    {/key}
    <span class="tape tag" class:on={showTag} aria-hidden="true">{tag}</span>
  </div>
  <div class="col">
    {#each PARTS as part, i (part.key)}
      <button class="arrow alt" type="button" aria-label={t('avNext', { part: t(part.key) })} onclick={() => step(i, 1)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    {/each}
  </div>
</div>
<p class="legend">{PARTS.map((p) => t(p.key)).join(' · ')}</p>
<button class="btn small dice" class:rolling type="button" onclick={roll}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <circle cx="9" cy="9" r="1.2" /><circle cx="15" cy="15" r="1.2" /><circle cx="15" cy="9" r="1.2" /><circle cx="9" cy="15" r="1.2" /><circle cx="12" cy="12" r="1.2" />
  </svg>
  {t('roll')}
</button>
<p class="sr-only" aria-live="polite">{showTag ? tag : ''}</p>

<style>
  .maker {
    display: grid;
    grid-template-columns: 44px minmax(0, 200px) 44px;
    justify-content: center;
    gap: 10px;
  }
  .col {
    display: grid;
    grid-template-rows: repeat(5, 1fr);
    gap: 4px;
  }
  .arrow {
    display: grid;
    place-items: center;
    min-height: 36px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 12px 5px 10px 6px / 6px 10px 5px 12px;
    background: var(--card);
    -webkit-tap-highlight-color: transparent;
    transition: transform 80ms;
  }
  .arrow.alt {
    border-radius: 6px 11px 5px 12px / 12px 5px 11px 6px;
  }
  .arrow svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  @media (hover: hover) {
    .arrow:hover {
      background: #f4ffd6;
    }
  }
  .arrow:active {
    transform: scale(0.92);
    background: var(--hi);
  }
  .arrow:focus-visible {
    outline: 3px solid var(--tape-2);
    outline-offset: 2px;
  }
  .stage {
    position: relative;
    aspect-ratio: 1;
    border-radius: 4px;
    background: #ffffff;
    box-shadow: 0 0 0 2px var(--ink), 3px 4px 0 2px rgb(43 45 51 / 0.12);
  }
  .face {
    position: absolute;
    inset: 6%;
    display: grid;
  }
  .face :global(.av) {
    width: 100% !important;
    height: 100% !important;
    background: transparent;
  }
  .hop {
    animation: hop 0.5s ease-out;
  }
  @keyframes hop {
    35% {
      transform: translateY(-10px) rotate(-3deg);
    }
    70% {
      transform: translateY(0) rotate(1deg);
    }
  }
  .tag {
    position: absolute;
    left: 50%;
    top: -12px;
    z-index: 2;
    transform: translateX(-50%) rotate(-3deg);
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.25s;
    pointer-events: none;
  }
  .tag.on {
    opacity: 1;
    transition: none;
  }
  .legend {
    margin: 2px 0 0;
    text-align: center;
    font-size: 12px;
    color: var(--mute);
  }
  .dice {
    align-self: center;
  }
  .dice svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .dice svg circle {
    fill: currentColor;
    stroke: none;
  }
  .rolling svg {
    animation: roll 0.45s ease-out;
  }
  @keyframes roll {
    to {
      transform: rotate(360deg);
    }
  }
</style>
