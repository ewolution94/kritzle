<!--
  The big screen (/<code>/screen): the game for a projector or a screen shared in a call, without
  a seat and without controls. It never knows the word before everyone does. Fits 1280 × 720 to
  1920 × 1080 without scrolling, and keeps the display awake.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type ChainEntry } from '../lib/api';
  import { num, t, type Key } from '../lib/i18n.svelte';
  import Logo from './Logo.svelte';
  import Picture from './Picture.svelte';
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
  const names = $derived(new Map((view?.players ?? []).map((p) => [p.id, p.name])));
  const teamName = (team: number) => t(`team_${team}` as Key);
  let chains: { owner: string; entries: ChainEntry[] }[] | null = $state(null);
  $effect(() => {
    if (turn?.kind === 'telephone' && turn.phase === 'showcase' && !chains) api.chains(code).then((c) => (chains = c.chains), () => {});
  });
  function upTo(all: { owner: string; entries: ChainEntry[] }[] | null, show: { chain: number; entry: number } | null | undefined) {
    if (!all || !show) return [];
    return all[show.chain]?.entries.slice(Math.max(0, show.entry - 2), show.entry + 1) ?? [];
  }
  const ranked = $derived(view ? [...view.players].sort((a, b) => b.score - a.score) : []);
  const tie = $derived(ranked.length > 1 && ranked[0].score === ranked[1].score);
  const telephone = $derived(view?.game?.mode === 'telephone');
  const teamScores = $derived(view?.teams ? view.teams.map((score, team) => ({ team, score })).sort((a, b) => b.score - a.score) : null);
  const teamTie = $derived(Boolean(teamScores && teamScores.length > 1 && teamScores[0].score === teamScores[1].score));

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

{#if view?.phase !== 'gone'}
  <ewo-connection class="connection" state={room.live ? 'online' : room.wasLive ? 'reconnecting' : 'connecting'}></ewo-connection>
{/if}

<div class="screen">
  {#if !view}
    <p class="display big">{t(room.wasLive ? 'reconnecting' : 'connecting')}</p>
  {:else if view.phase === 'gone'}
    <p class="display big">{t('gone')}</p>
  {:else if view.phase === 'lobby'}
    <div class="lobby">
      <div class="join">
        <Logo />
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
      {#if telephone}
        <h2 class="display big"><span class="hl">{t('telephoneEnd')}</span></h2>
        <ul class="crowd">
          {#each view.players as p (p.id)}
            <li><Avatar avatar={p.avatar} size={72} /><span>{p.name}</span></li>
          {/each}
        </ul>
      {:else if teamScores}
        <h2 class="display big"><span class="hl">{teamTie ? t('tie') : t('teamWins', { name: teamName(teamScores[0].team) })}</span></h2>
        <ol>
          {#each teamScores as x, i (x.team)}
            <li class:first={i === 0}>
              <span class="rank">{i + 1}.</span>
              <span class="team-tag t{x.team}">{teamName(x.team)}</span>
              <span class="name">{view.players.filter((p) => p.team === x.team).map((p) => p.name).join(', ')}</span>
              <span class="score">{num(x.score)}</span>
            </li>
          {/each}
        </ol>
      {:else}
        <h2 class="display big"><span class="hl">{tie ? t('tie') : t('winner', { name: ranked[0]?.name ?? '' })}</span></h2>
        <ol>
          {#each ranked.slice(0, 8) as p, i (p.id)}
            <li class:first={i === 0}>
              <span class="rank">{i + 1}.</span>
              <Avatar avatar={p.avatar} size={i === 0 ? 72 : 48} crown={i === 0 && !tie} />
              <span class="name">{p.name}</span>
              <span class="score">{num(p.score)}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else if turn && turn.kind === 'telephone'}
    <div class="phone-game">
      <header>
        <span class="label">{t('mode_telephone')}</span>
        <span class="display what">
          {#if turn.phase === 'showcase'}{t('chainOf', { name: names.get(turn.show?.owner ?? '') ?? '' })}
          {:else}{t('stepOf', { n: (turn.step ?? 0) + 1, total: turn.steps ?? 1 })} · {t('waitOthers', { n: turn.done?.length ?? 0, total: view.players.length })}{/if}
        </span>
        {#if turn.phase === 'tell' && turn.startsAt}{#key turn.step}<Clock {room} from={turn.startsAt} to={turn.endsAt} />{/key}{/if}
      </header>
      {#if turn.phase === 'showcase'}
        <ol class="chain">
          {#each upTo(chains, turn.show) as e, i (i)}
            <li>
              <span class="by">{names.get(e.player) ?? ''}</span>
              {#if e.kind === 'text'}<p class="said display">„{e.text}“</p>{:else}<div class="pic"><Picture ops={e.ops ?? []} /></div>{/if}
            </li>
          {/each}
        </ol>
      {:else}
        <Players {view} />
      {/if}
    </div>
  {:else if turn && turn.kind === 'forger'}
    <div class="turn">
      <aside><Players {view} /></aside>
      <div class="middle">
        <header>
          <span class="label">{t('round', { n: turn.round, total: view.game?.rounds ?? 1 })} · {t('theme', { name: t(`pack_${turn.category}` as Key) })}</span>
          <span class="display what">
            {#if turn.phase === 'forge'}{t('waitStroke', { name: names.get(turn.stroke?.player ?? '') ?? '' })}
            {:else if turn.phase === 'vote'}{t('voteHint')}
            {:else if turn.phase === 'unmask'}{t('unmaskWait', { name: names.get(Object.entries(turn.tally ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '') ?? '' })}
            {:else}<span class="hl">{turn.word}</span> · {t('forgerWas', { name: names.get(turn.forger ?? '') ?? '' })}{/if}
          </span>
          {#if turn.phase === 'forge' && turn.stroke}{#key turn.step}<Clock {room} from={turn.stroke.endsAt - view.settings.strokeSeconds * 1000} to={turn.stroke.endsAt} />{/key}{/if}
        </header>
        <div class="sheet"><Canvas {room} {turn} /></div>
      </div>
      <aside class="talk"><Chat {room} {view} /></aside>
    </div>
  {:else if turn && turn.kind === 'duel' && turn.teams}
    <div class="turn duel">
      <div class="middle wide">
        <header>
          <span class="label">{t('round', { n: turn.round, total: view.game?.rounds ?? 1 })}</span>
          <span class="display what pattern">{turn.phase === 'reveal' ? turn.word : turn.pattern ? turn.pattern.split('').join(' ') : t('hiddenWord')}</span>
          {#if turn.phase === 'draw' && turn.startsAt}<Clock {room} from={turn.startsAt} to={turn.endsAt} />{/if}
        </header>
        <div class="grid" style:--n={turn.teams.length} style:--rows={Math.ceil(turn.teams.length / 2)}>
          {#each turn.teams as x (x.team)}
            <figure>
              <Canvas {room} {turn} team={x.team} />
              <figcaption>
                <span class="team-tag t{x.team}">{teamName(x.team)}</span>
                {names.get(x.drawer) ?? ''}{x.done ? ' ✓' : ''}
                <span class="score">{num(view.teams?.[x.team] ?? 0)}</span>
              </figcaption>
            </figure>
          {/each}
        </div>
      </div>
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
  .connection {
    --ewo-connection-top: 2vh;
    --ewo-connection-bg: var(--ink);
    --ewo-connection-fg: var(--paper);
  }
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
  .join :global(.logo) {
    font-size: 8vh;
  }
  /* A flex item, the logo was a block here: its highlighter spans the line box, not the glyphs. */
  .join :global(.logo .ink) {
    display: block;
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
  .phone-game {
    display: flex;
    flex-direction: column;
    gap: 3vh;
    height: 100%;
  }
  .chain {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    gap: 2vw;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chain li {
    flex: 0 1 calc((100% - 4vw) / 3);
    display: flex;
    flex-direction: column;
    gap: 1vh;
    min-width: 0;
  }
  .by {
    font: 600 2vh/1.2 var(--ewo-sans);
  }
  .said {
    margin: 0;
    padding: 2vh 1.4vw;
    border: 2px solid var(--ink);
    border-radius: 16px 16px 16px 4px;
    background: var(--card);
    font-size: 4vh;
  }
  .duel {
    grid-template-columns: minmax(0, 1fr);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(min(var(--n), 2), minmax(0, 1fr));
    gap: 2vh 2vw;
    min-height: 0;
  }
  .grid figure {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.8vh;
    width: min(100%, calc((100dvh - 30vh) / var(--rows, 1) * 4 / 3));
  }
  .grid figcaption {
    display: flex;
    align-items: center;
    gap: 1vw;
    font: 600 2vh/1.2 var(--ewo-sans);
  }
  .grid .score {
    margin-left: auto;
    font-family: var(--ewo-mono);
  }
  .team-tag {
    padding: 0.2vh 0.6vw;
    border-radius: 6px;
    color: #ffffff;
    font-weight: 700;
  }
  .t0 { background: #c9341f; }
  .t1 { background: #2d5bd8; }
  .t2 { background: #8a6d00; }
  .t3 { background: #1f7a45; }
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
  .crowd {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3vh 3vw;
    margin: 2vh 0 0;
    padding: 0;
    list-style: none;
  }
  .crowd li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1vh;
    font: 600 2.4vh/1.2 var(--ewo-sans);
  }
</style>
