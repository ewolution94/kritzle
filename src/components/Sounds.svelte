<!-- Listens to the room and plays the game's sounds (src/lib/sound.svelte.ts). Renders nothing. -->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { Room } from '../lib/room.svelte';
  import { play, unlockOnGesture } from '../lib/sound.svelte';

  let { room }: { room: Room } = $props();

  let phase = '';
  let turnKey = '';
  let lastLine = 0;
  let lastTick = -1;

  onMount(() => {
    unlockOnGesture();
    lastLine = room.chat.at(-1)?.id ?? 0;
    const id = setInterval(() => {
      const t = room.view?.turn;
      if (!t || room.view?.phase !== 'draw' || !t.endsAt) return;
      const left = Math.ceil(room.left(t.endsAt) / 1000);
      if (left <= 5 && left > 0 && left !== lastTick) {
        lastTick = left;
        play.tick();
      }
    }, 200);
    return () => clearInterval(id);
  });

  $effect(() => {
    const v = room.view;
    if (!v) return;
    const key = `${v.turn?.n ?? 0}:${v.phase}`;
    if (key === turnKey) return;
    turnKey = key;
    const me = v.me;
    const t = v.turn;
    if (v.phase === 'final' && phase !== 'final') play.fanfare();
    else if (v.phase === 'reveal') play.reveal();
    else if (v.phase === 'choose' && t?.drawer === me) play.yourTurn();
    else if (v.phase === 'draw' && t?.kind === 'duel' && t.teams?.some((x) => x.drawer === me)) play.yourTurn();
    else if (v.phase === 'draw') play.start();
    else if (v.phase === 'forge' && t?.stroke?.player === me) play.yourTurn();
    phase = v.phase;
  });

  // Fälscher: each new stroke turn of yours gets the chime too.
  let stroke = -1;
  $effect(() => {
    const t = room.view?.turn;
    if (t?.kind === 'forger' && t.phase === 'forge' && t.stroke?.player === room.view?.me && t.step !== stroke) {
      stroke = t.step ?? -1;
      play.yourTurn();
    }
  });

  $effect(() => {
    const lines = room.chat;
    const fresh = lines.filter((l) => l.id > lastLine);
    if (!fresh.length) return;
    lastLine = fresh.at(-1)!.id;
    for (const l of fresh) {
      if (l.kind === 'guessed' || l.kind === 'team') l.player === room.view?.me ? play.mine() : play.guessed();
    }
  });
</script>
