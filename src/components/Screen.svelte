<!--
  The big screen (/<code>/screen): the game for a projector or a screen shared in a call, without
  a seat and without controls. It never knows the word before everyone does. Fits 1280 × 720 to
  1920 × 1080 without scrolling, and keeps the display awake.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { num, t } from '../lib/i18n.svelte';
  import { Room } from '../lib/room.svelte';
  import Avatar from './Avatar.svelte';
  import Canvas from './Canvas.svelte';
  import Chat from './Chat.svelte';
  import Clock from './Clock.svelte';
  import Players from './Players.svelte';
  import Qr from './Qr.svelte';

  let { code }: { code: string } = $props();

  // The page keys this component by its code (App.svelte), so the first value is the only one.
  // svelte-ignore state_referenced_locally
  const room = new Room(code);
  const view = $derived(room.view);
  const link = $derived(`${location.origin}/${code}`);
  const turn = $derived(view?.turn ?? null);
  const drawer = $derived(view?.players.find((p) => p.id === turn?.drawer));
  const ranked = $derived(view ? [...view.players].sort((a, b) => b.score - a.score) : []);

  onMount(() => {
    room.connect();
    let lock: { release(): Promise<void> } | null = null;
    const wake = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null;
      } catch {
        // Not allowed here: the screen may dim.
      }
    };
    void wake();
    const again = () => document.visibilityState === 'visible' && void wake();
    document.addEventListener('visibilitychange', again);
    return () => {
      room.close();
      document.removeEventListener('visibilitychange', again);
      void lock?.release().catch(() => {});
    };
  });
</script>

<div class="screen">
  {#if !view}
    <p class="display big">{t('reconnecting')}</p>
  {:else if view.phase === 'gone'}
    <p class="display big">{t('gone')}</p>
  {:else if view.phase === 'lobby'}
    <div class="lobby">
      <div class="join">
        <span class="logo">Kritzle</span>
        <div class="qr box"><Qr url={link} /></div>
        <span class="label">{t('screenScan')}</span>
        <span class="code display">{code}</span>
        <span class="url">{link.replace(/^https?:\/\//, '')}</span>
      </div>
      <div class="people">
        <h2 class="display">{t('screenWaiting')}</h2>
        <p class="label">{t('screenIn', { n: view.players.length })}</p>
        <ul>
          {#each view.players as p (p.id)}
            <li><Avatar avatar={p.avatar} size={72} boil /><span>{p.name}</span></li>
          {/each}
        </ul>
      </div>
    </div>
  {:else if view.phase === 'final'}
    <div class="end">
      <h2 class="display big"><span class="hl">{t('winner', { name: ranked[0]?.name ?? '' })}</span></h2>
      <ol>
        {#each ranked.slice(0, 8) as p, i (p.id)}
          <li class:first={i === 0}>
            <span class="rank">{i + 1}.</span>
            <Avatar avatar={p.avatar} size={i === 0 ? 72 : 48} crown={i === 0} />
            <span class="name">{p.name}</span>
            <span class="score">{num(p.score)}</span>
          </li>
        {/each}
      </ol>
    </div>
  {:else if turn}
    <div class="turn">
      <aside><Players {view} /></aside>
      <div class="middle">
        <header>
          <span class="label">{t('round', { n: turn.round, total: view.game?.rounds ?? 1 })}</span>
          {#if turn.phase === 'choose'}
            <span class="display what">{t('choosing', { name: drawer?.name ?? '' })}</span>
          {:else if turn.phase === 'reveal'}
            <span class="display what"><span class="hl">{turn.word}</span></span>
          {:else}
            <span class="display what pattern">{turn.pattern ? turn.pattern.split('').join(' ') : t('hiddenWord')}</span>
            {#if turn.startsAt}<Clock {room} from={turn.startsAt} to={turn.endsAt} />{/if}
          {/if}
        </header>
        <div class="sheet"><Canvas {room} {turn} /></div>
        <p class="who">{t('drawing', { name: drawer?.name ?? '' })}</p>
      </div>
      <aside class="talk"><Chat {room} {view} /></aside>
    </div>
  {/if}
</div>

<style>
  .screen {
    height: 100dvh;
    overflow: hidden;
    padding: 2.2vh 2.4vw;
  }
  .big {
    margin: 30vh 0 0;
    text-align: center;
    font-size: 6vh;
  }
  .lobby {
    display: grid;
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
    gap: 4vw;
    height: 100%;
    align-items: center;
  }
  .join {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.6vh;
  }
  .join .logo {
    font-size: 8vh;
  }
  .qr {
    width: 32vh;
    padding: 1.4vh;
  }
  .code {
    font-size: 11vh;
    line-height: 0.9;
    letter-spacing: 0.06em;
  }
  .url {
    font: 500 2.2vh/1.2 var(--ewo-mono);
    color: var(--mute);
  }
  .people h2 {
    margin: 0;
    font-size: 6vh;
  }
  .people ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14vh, 1fr));
    gap: 3vh 2vw;
    margin: 3vh 0 0;
    padding: 0;
    list-style: none;
  }
  .people li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1vh;
    font: 600 2.2vh/1.2 var(--ewo-sans);
  }
  .turn {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 3fr) minmax(0, 1.1fr);
    gap: 2vw;
    height: 100%;
  }
  .turn aside {
    min-height: 0;
    overflow: hidden;
  }
  .middle {
    display: flex;
    flex-direction: column;
    gap: 1.4vh;
    min-height: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2vw;
    min-height: 8vh;
  }
  .what {
    flex: 1;
    font-size: 5.4vh;
    line-height: 1;
  }
  .pattern {
    letter-spacing: 0.08em;
  }
  .sheet {
    width: min(100%, calc((100dvh - 4.4vh - 8vh - 8vh) * 4 / 3));
    margin: 0 auto;
  }
  .who {
    margin: 0;
    text-align: center;
    color: var(--mute);
    font-size: 2vh;
  }
  .end {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3vh;
  }
  .end h2 {
    margin: 4vh 0 0;
  }
  .end ol {
    display: flex;
    flex-direction: column;
    gap: 1.4vh;
    margin: 0;
    padding: 0;
    list-style: none;
    min-width: 40vw;
  }
  .end li {
    display: flex;
    align-items: center;
    gap: 1.4vw;
    font: 600 2.6vh/1.2 var(--ewo-sans);
  }
  .end li.first {
    font-size: 3.6vh;
  }
  .end .name {
    flex: 1;
  }
  .end .score {
    font-family: var(--ewo-mono);
  }
  .rank {
    width: 3vw;
    color: var(--mute);
  }
</style>
