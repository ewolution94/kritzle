<!--
  A face from its five numbers (src/lib/avatar.ts). `boil` redraws it three ways in turn, like the
  logo; `mood` makes it happy for a moment (a right guess), `crown` is the winner's.
-->
<script lang="ts">
  import { avatarSvg, type Avatar, type Mood } from '../lib/avatar';

  let {
    avatar,
    size = 40,
    mood = '',
    crown = false,
    boil = false,
    ring = true,
  }: { avatar: Avatar; size?: number; mood?: Mood; crown?: boolean; boil?: boolean; ring?: boolean } = $props();

  const frames = $derived(boil ? [0, 1, 2].map((frame) => avatarSvg(avatar, { frame, mood, crown })) : [avatarSvg(avatar, { mood, crown })]);
</script>

<span class="av" class:ring class:boil class:crown style:--size="{size}px">
  {#each frames as svg, i (i)}
    <span class="frame">{@html svg}</span>
  {/each}
</span>

<style>
  .av {
    position: relative;
    display: inline-block;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: #ffffff;
  }
  .av.ring {
    box-shadow: 0 0 0 2px var(--ink);
  }
  .av.crown {
    overflow: visible;
  }
  .frame {
    position: absolute;
    inset: 0;
  }
  .frame :global(svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .av:not(.crown) .frame {
    overflow: hidden;
    border-radius: 50%;
  }
  .boil .frame:nth-child(1) {
    animation: f 0.42s steps(1) infinite;
  }
  .boil .frame:nth-child(2) {
    animation: f 0.42s -0.28s steps(1) infinite;
  }
  .boil .frame:nth-child(3) {
    animation: f 0.42s -0.14s steps(1) infinite;
  }
  @keyframes f {
    0% {
      opacity: 1;
    }
    33.33% {
      opacity: 0;
    }
    100% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .boil .frame {
      animation: none !important;
    }
    .boil .frame:nth-child(n + 2) {
      opacity: 0;
    }
  }
</style>
