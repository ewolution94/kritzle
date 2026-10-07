<!--
  A face from its five numbers, drawn by Folio's doodle emblem (src/lib/avatar.ts). `boil` redraws
  it three ways in turn, like the logo; `mood` makes it happy for a moment (a right guess), `crown`
  is the winner's.
-->
<script lang="ts">
  import type { Avatar, Mood } from '../lib/avatar';

  let {
    avatar,
    size = 40,
    mood = '',
    crown = false,
    boil = false,
    ring = true,
  }: { avatar: Avatar; size?: number; mood?: Mood; crown?: boolean; boil?: boolean; ring?: boolean } = $props();
</script>

<ewo-emblem class="av" theme="doodle" value={avatar} {size} {mood} {crown} {boil} {ring}></ewo-emblem>

<style>
  .av {
    --ewo-emblem-ink: var(--ink);
  }
</style>
