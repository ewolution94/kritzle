<!--
  Fälscher: everyone but the forger knows the word; in turns, each adds one stroke in their own
  colour to one drawing, twice round the table; then everyone points at the forger, who, caught,
  may still name the word. The same stage as a turn (Turn.svelte): it fills the visible screen and
  follows visualViewport, so the keyboard never covers the drawing.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { lockScroll } from '../../vendor/ewo/elements/scroll-lock.js';
  import { ApiError, type View } from '../lib/api';
  import { errorText, t, type Key } from '../lib/i18n.svelte';
  import { PALETTE } from '../lib/ink';
  import type { Room } from '../lib/room.svelte';
  import { actAt } from '../lib/waits';
  import Avatar from './Avatar.svelte';
  import Canvas from './Canvas.svelte';
  import Chat from './Chat.svelte';
  import Clock from './Clock.svelte';
  import Players from './Players.svelte';
  import Settings from './Settings.svelte';

  let { room, view }: { room: Room; view: View } = $props();

  let settingsOpen = $state(false);
  let typing = $state(false);
  let error = $state('');
  let guess = $state('');
  let passed = $state(-1);
  let stage: HTMLDivElement;

  const turn = $derived(view.turn!);
  const names = $derived(new Map(view.players.map((p) => [p.id, p])));
  const isHost = $derived(view.me === view.host);
  const myStroke = $derived(turn.phase === 'forge' && turn.stroke?.player === view.me && passed !== turn.step);
  const strokePlayer = $derived(turn.stroke ? names.get(turn.stroke.player) : null);
  const forger = $derived(turn.forger ? names.get(turn.forger) : null);
  const lap = $derived(turn.order && turn.step !== undefined ? Math.min(turn.laps ?? 1, Math.floor(Math.max(0, turn.step) / turn.order.length) + 1) : 1);
  const myColor = $derived(view.me && turn.colors ? (turn.colors[view.me] ?? 0) : 0);
  const caughtName = $derived(turn.tally ? leader(turn.tally) : null);

  function leader(tally: Record<string, number>) {
    const top = Math.max(0, ...Object.values(tally));
    const ids = Object.entries(tally).filter(([, n]) => n === top);
    return ids.length === 1 ? names.get(ids[0][0])?.name ?? null : null;
  }

  onMount(() => {
    const unlock = lockScroll();
    document.documentElement.dataset.playing = '';
    const vv = window.visualViewport;
    const fit = () => {
      stage?.style.setProperty('--vv-h', `${vv ? vv.height : innerHeight}px`);
      stage?.style.setProperty('--vv-top', `${vv ? vv.offsetTop : 0}px`);
    };
    fit();
    vv?.addEventListener('resize', fit);
    vv?.addEventListener('scroll', fit);
    addEventListener('resize', fit);
    return () => {
      unlock();
      delete document.documentElement.dataset.playing;
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      removeEventListener('resize', fit);
    };
  });

  /** A move; with the tapped control, the wait shows there (src/lib/waits.ts). */
  async function act(action: string, body?: unknown, from?: Event) {
    error = '';
    try {
      await actAt(room, action, body, from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
      setTimeout(() => (error = ''), 2500);
    }
  }

  /** The pen lifted: that was this player's stroke. */
  async function stroked() {
    passed = turn.step ?? -1;
    await room.settle();
    void act('pass');
  }

  function unmask(event: SubmitEvent) {
    event.preventDefault();
    if (guess.trim()) void act('unmask', { text: guess.trim() }, event);
  }

  function focusIn(event: FocusEvent) {
    if ((event.target as HTMLElement).matches('input') && matchMedia('(pointer: coarse)').matches) typing = true;
  }

  const outcome = $derived(
    turn.ended === 'escaped'
      ? t('forgerEscaped', { name: forger?.name ?? '' })
      : turn.ended === 'guessed'
        ? t('forgerGuessed', { name: forger?.name ?? '' })
        : turn.ended === 'caught'
          ? t('forgerCaught', { name: forger?.name ?? '' })
          : t('ended_skip'),
  );
</script>

<div class="stage" class:typing bind:this={stage}>
  <header class="top">
    <div class="status">
      <span class="label round">{t('round', { n: turn.round, total: view.game?.rounds ?? 1 })} · {t('theme', { name: t(`pack_${turn.category}` as Key) })}</span>
      {#if turn.phase === 'reveal'}
        <span class="what"><span class="label inline">{t('wordWas')}</span> <span class="word display hl">{turn.word}</span></span>
      {:else if turn.forgerMe}
        <span class="what"><span class="word display forger">{t('youForge')}</span></span>
      {:else}
        <span class="what"><span class="label inline">{t('theWord')}</span> <span class="word display hl">{turn.word}</span></span>
      {/if}
    </div>
    <div class="end">
      {#if isHost && turn.phase !== 'reveal'}
        <button class="icon" type="button" aria-label={t('skipTurn')} title={t('skipTurn')} onclick={(e) => act('skip', undefined, e)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></svg>
        </button>
      {/if}
      {#if turn.phase === 'forge' && turn.stroke}
        {#key turn.step}<Clock {room} from={turn.stroke.endsAt - (view.settings.strokeSeconds ?? 15) * 1000} to={turn.stroke.endsAt} />{/key}
      {:else if (turn.phase === 'vote' || turn.phase === 'unmask') && turn.endsAt}
        {#key turn.phase}<Clock {room} from={turn.endsAt - (turn.phase === 'vote' ? 30000 : 20000)} to={turn.endsAt} />{/key}
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <ewo-settings-button onclick={() => (settingsOpen = true)}></ewo-settings-button>
    </div>
  </header>

  <aside class="side"><div class="panel"><Players {view} /></div></aside>

  <div class="center">
    <div class="sheet-box">
      <Canvas {room} {turn} drawing={myStroke} stroke={{ color: myColor }} size={1} onstroke={stroked}>
        {#if turn.phase === 'reveal'}
          <div class="overlay soft">
            <div class="reveal box">
              <span class="tape">{outcome}</span>
              {#if forger}
                <span class="who"><Avatar avatar={forger.avatar} size={48} /> <span>{t('forgerWas', { name: forger.name })}</span></span>
              {/if}
              {#if turn.forgerGuess}<span class="none">{t('forgerSaid', { text: turn.forgerGuess })}</span>{/if}
            </div>
          </div>
        {:else if myStroke}
          <div class="your-turn" aria-live="polite"><span class="tape teal">{t('yourStroke')}</span></div>
        {/if}
      </Canvas>
    </div>

    {#if turn.phase === 'forge' && turn.order}
      <ol class="order" aria-label={t('tableOrder')}>
        {#each turn.order as id, i (id)}
          {@const p = names.get(id)}
          {#if p}
            <li class:now={turn.stroke?.player === id}>
              <span class="ink" style:background={PALETTE[turn.colors?.[id] ?? 0]}></span>
              <Avatar avatar={p.avatar} size={30} />
              <span class="n">{p.name}</span>
            </li>
          {/if}
          {#if i === turn.order.length - 1}<li class="lap label">{t('lapOf', { n: lap, total: turn.laps ?? 1 })}</li>{/if}
        {/each}
      </ol>
      <p class="hint">{myStroke ? t('yourStrokeHint') : t('waitStroke', { name: strokePlayer?.name ?? '' })}</p>
    {:else if turn.phase === 'vote'}
      <div class="vote">
        <p class="hint">{t('voteHint')}</p>
        <div class="choices">
          {#each view.players.filter((p) => p.id !== view.me) as p (p.id)}
            <button class="chip person" type="button" aria-pressed={turn.myVote === p.id} onclick={(e) => act('vote', { player: p.id }, e)}>
              <Avatar avatar={p.avatar} size={26} ring={false} />
              {p.name}
              {#if turn.voted?.includes(p.id)}<span class="tick" aria-label={t('voted')}>✓</span>{/if}
            </button>
          {/each}
        </div>
      </div>
    {:else if turn.phase === 'unmask'}
      <div class="vote">
        {#if turn.forgerMe}
          <form class="unmask" onsubmit={unmask}>
            <p class="hint">{t('unmaskHint')}</p>
            <div class="row">
              <input class="input" bind:value={guess} maxlength="40" autocomplete="off" placeholder={t('unmaskPlaceholder')} />
              <button class="btn primary" type="submit">{t('unmaskGo')}</button>
            </div>
          </form>
        {:else}
          <p class="hint">{t('unmaskWait', { name: caughtName ?? '' })}</p>
        {/if}
      </div>
    {:else if turn.phase === 'reveal' && turn.tally}
      <ul class="tally">
        {#each Object.entries(turn.tally).sort((a, b) => b[1] - a[1]) as [id, n] (id)}
          <li><Avatar avatar={names.get(id)?.avatar ?? [0, 0, 0, 0, 0]} size={24} /> {names.get(id)?.name} <b>{n}</b></li>
        {/each}
      </ul>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="strip"><Players {view} strip /></div>
  </div>

  <section class="talk" onfocusin={focusIn} onfocusout={() => (typing = false)}>
    <Chat {room} {view} compact />
  </section>

</div>

<Settings open={settingsOpen} onclose={() => (settingsOpen = false)} />

<style>
  .stage {
    position: fixed;
    inset-inline: 0;
    top: var(--vv-top, 0px);
    z-index: 10;
    height: var(--vv-h, 100dvh);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
    grid-template-areas: 'top' 'center' 'talk';
    gap: 8px;
    padding: 0 12px max(10px, env(safe-area-inset-bottom));
    background-color: var(--paper);
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 16px 16px;
    background-position: -1px -1px;
    overflow: hidden;
  }
  .top {
    grid-area: top;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-height: 56px;
    padding-top: env(safe-area-inset-top);
    border-bottom: 2px solid rgb(43 45 51 / 0.12);
  }
  .status {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .what {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 8px;
  }
  .label.inline {
    font-size: 11px;
  }
  .word {
    font-size: 26px;
    line-height: 1;
  }
  .word.forger {
    color: var(--bad);
  }
  .end {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    padding: 0;
    border: 2px solid var(--ink);
    border-radius: 10px 4px 9px 5px / 5px 9px 4px 10px;
    background: var(--card);
  }
  .icon svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linejoin: round;
  }
  .side {
    display: none;
  }
  .center {
    grid-area: center;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .sheet-box {
    --reserve: 360px;
    width: min(100%, calc((var(--vv-h, 100dvh) - var(--reserve)) * 4 / 3));
    min-width: 200px;
    margin: 8px auto 0;
  }
  .typing .sheet-box {
    --reserve: 190px;
  }
  .typing .strip,
  .typing .order,
  .typing .hint {
    display: none;
  }
  .talk {
    grid-area: talk;
    min-height: 0;
  }
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgb(253 253 251 / 0.55);
  }
  .reveal {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 22px 18px 14px;
    text-align: center;
    max-width: 92%;
  }
  .reveal .tape {
    position: absolute;
    top: -12px;
    transform: rotate(-3deg);
    white-space: nowrap;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 10px;
    font: 700 16px/1.2 var(--ewo-sans);
  }
  .none {
    font-size: 13px;
    color: var(--mute);
  }
  .your-turn {
    position: absolute;
    left: 50%;
    top: 10px;
    z-index: 4;
    transform: translateX(-50%) rotate(-2deg);
    pointer-events: none;
  }
  .order {
    display: flex;
    gap: 6px;
    margin: 0;
    padding: 2px;
    list-style: none;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .order li {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: 58px;
    padding: 4px;
    border-radius: 9px;
    font: 600 11px/1.2 var(--ewo-sans);
  }
  .order li.now {
    background: var(--hi-soft);
    box-shadow: inset 0 0 0 2px var(--ink);
  }
  .order .ink {
    width: 22px;
    height: 5px;
    border-radius: 3px;
  }
  .order .n {
    max-width: 62px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .order .lap {
    justify-content: center;
    min-width: auto;
  }
  .hint {
    margin: 0;
    text-align: center;
    font-size: 13px;
    color: var(--mute);
  }
  .vote {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .vote .choices {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }
  .person {
    min-height: 40px;
    padding: 0 10px 0 4px;
  }
  .tick {
    font-weight: 700;
  }
  .unmask .row {
    display: flex;
    gap: 8px;
  }
  .unmask .input {
    flex: 1;
    min-width: 0;
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .tally li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .error {
    margin: 0;
    text-align: center;
  }
  /* A wide screen: one table in the middle, as in a classic turn (Turn.svelte). */
  @media (min-width: 900px) {
    .stage {
      --side-w: clamp(200px, 14vw, 230px);
      --talk-w: clamp(250px, 20vw, 320px);
      --col-gap: 16px;
      --wide-reserve: 232px;
      --canvas-w: min(
        1360px,
        calc(100vw - var(--side-w) - var(--talk-w) - 2 * var(--col-gap) - 40px),
        calc((var(--vv-h, 100dvh) - var(--wide-reserve)) * 4 / 3)
      );
      grid-template-columns: var(--side-w) var(--canvas-w) var(--talk-w);
      grid-template-rows: auto auto;
      grid-template-areas: 'top top top' 'side center talk';
      justify-content: center;
      /* Centred while it fits; never cut off at the top when it doesn't. */
      align-content: center;
      align-content: safe center;
      column-gap: var(--col-gap);
      row-gap: 14px;
      padding: 12px 20px 16px;
    }
    .top {
      display: grid;
      grid-template-columns: subgrid;
      align-items: center;
      min-height: 0;
      padding: 0 0 6px;
      border-bottom: 0;
    }
    .status {
      display: contents;
    }
    .round {
      grid-column: 1;
      justify-self: start;
      font: 400 24px/1.1 var(--display);
      letter-spacing: 0;
      text-transform: none;
      color: var(--ink);
    }
    .what {
      grid-column: 2;
      justify-self: center;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      text-align: center;
    }
    .word {
      font-size: 42px;
    }
    .end {
      grid-column: 3;
      justify-self: end;
    }
    .side {
      display: block;
      grid-area: side;
      contain: size;
    }
    .panel,
    .talk {
      background: var(--card);
      border: 2px solid var(--ink);
      border-radius: var(--hand);
      box-shadow: var(--shadow);
    }
    .panel {
      max-height: 100%;
      overflow-y: auto;
      padding: 8px;
    }
    .strip {
      display: none;
    }
    .center {
      gap: 12px;
    }
    .sheet-box {
      width: 100%;
      min-width: 0;
      margin: 0;
    }
    .talk {
      display: flex;
      flex-direction: column;
      contain: size;
      padding: 8px;
      border-radius: var(--hand-2);
    }
  }
</style>
