<!--
  A turn: choose → draw → reveal, on one stage that fills the visible screen. On a phone the
  canvas sits on top, then the dock (the drawer) or the reactions, the players' strip and the chat;
  while typing, the strip and reactions step aside and the canvas shrinks so the keyboard never
  covers it (the stage follows visualViewport: learnings/ios-and-webkit.md). On a wide screen the
  players are on the left and the chat on the right.

  A team duel shows your team's canvas while it draws, and every team's at the end. Würze shows as
  a strip of tape under the word, for everyone.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { lockScroll } from '../../vendor/ewo/elements/scroll-lock.js';
  import { ApiError, type View } from '../lib/api';
  import { MULTIPLIERS } from '../lib/words';
  import { errorText, num, t, type Key } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';
  import Avatar from './Avatar.svelte';
  import Canvas, { type Tool } from './Canvas.svelte';
  import Chat from './Chat.svelte';
  import Clock from './Clock.svelte';
  import Dock from './Dock.svelte';
  import Players from './Players.svelte';
  import Settings from './Settings.svelte';

  let { room, view }: { room: Room; view: View } = $props();

  let tool: Tool = $state('pen');
  let color = $state(0);
  let size = $state(1);
  let inkUsed = $state(0);
  let canvas: Canvas | undefined = $state();
  let typing = $state(false);
  let settingsOpen = $state(false);
  let error = $state('');
  let stage: HTMLDivElement;

  const turn = $derived(view.turn!);
  const duel = $derived(turn.kind === 'duel');
  const me = $derived(view.players.find((p) => p.id === view.me));
  const myTeam = $derived(duel ? (turn.teams?.find((x) => x.team === me?.team) ?? null) : null);
  const drawerId = $derived(duel ? (myTeam?.drawer ?? null) : turn.drawer);
  const isDrawer = $derived(Boolean(view.me) && drawerId === view.me);
  const drawer = $derived(view.players.find((p) => p.id === drawerId));
  const isHost = $derived(view.me === view.host);
  const drawingNow = $derived(isDrawer && turn.phase === 'draw');
  const slots = $derived(turn.pattern ? [...turn.pattern] : []);
  const letters = $derived(slots.filter((c) => c !== ' ' && c !== '-' && c !== '+').length);
  const ownTeam = $derived(duel ? (me?.team ?? null) : null);

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

  async function act(action: string, body?: unknown) {
    error = '';
    try {
      await room.act(action, body);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
      setTimeout(() => (error = ''), 2500);
    }
  }

  function like(value: number) {
    void act('like', { value: turn.like === value ? 0 : value });
  }

  // The keyboard is up on a touch screen: make room for it.
  function focusIn(event: FocusEvent) {
    if ((event.target as HTMLElement).matches('input') && matchMedia('(pointer: coarse)').matches) typing = true;
  }
  function focusOut() {
    typing = false;
  }

  const teamName = (team: number) => t(`team_${team}` as Key);
  const ended = $derived(
    turn.ended === 'drawer-gone'
      ? t('ended_drawer-gone', { name: drawer?.name ?? '' })
      : turn.ended === 'all'
        ? t('ended_all')
        : turn.ended === 'skip'
          ? t('ended_skip')
          : t('ended_time'),
  );
</script>

{#snippet dots(difficulty: string | undefined)}
  <span class="dots" aria-hidden="true">
    {#each ['easy', 'medium', 'hard'] as d, i (d)}
      <i class:on={['easy', 'medium', 'hard'].indexOf(difficulty ?? 'easy') >= i}></i>
    {/each}
  </span>
{/snippet}

<div class="stage" class:typing class:drawer={drawingNow} bind:this={stage}>
  <header class="top">
    <div class="status">
      <span class="label">
        {t('round', { n: turn.round, total: view.game?.rounds ?? 1 })}
        {#if duel && ownTeam !== null}· <span class="team-tag t{ownTeam}">{t('teamName', { name: teamName(ownTeam) })}</span>{/if}
      </span>
      {#if turn.phase === 'choose'}
        <span class="what">{isDrawer ? t('chooseWord') : t('choosing', { name: drawer?.name ?? '' })}</span>
      {:else if turn.phase === 'reveal'}
        <span class="what">{t('nextSoon')}</span>
      {:else if turn.word}
        <span class="what">
          <span class="label inline">{isDrawer ? t('youDraw') : t('gotIt')}</span>
          <span class="word display hl">{turn.word}</span>
          {@render dots(turn.difficulty)}
        </span>
      {:else}
        <span class="what">
          <span class="label inline">{t('drawing', { name: drawer?.name ?? '' })}</span>
          {#if turn.pattern}
            <span class="pattern" aria-label={t('letters', { n: letters })}>
              {#each slots as c, i (i)}
                {#if c === '_'}<span class="slot"></span>{:else if c === ' '}<span class="gap"></span>{:else}<span class="letter">{c}</span>{/if}
              {/each}
              <span class="count">{letters}</span>
            </span>
          {:else}
            <span class="word display">{t('hiddenWord')}</span>
          {/if}
          {@render dots(turn.difficulty)}
        </span>
      {/if}
      {#if turn.spice && turn.phase === 'draw'}
        <span class="tape spice" title={t(`spice_${turn.spice}_hint` as Key)}>{t('spiceIs', { name: t(`spice_${turn.spice}` as Key) })}</span>
      {/if}
    </div>
    <div class="end">
      {#if duel && view.teams}
        <span class="scores" aria-label={t('teamStandings')}>
          {#each view.teams as score, i (i)}<span class="score t{i}">{num(score)}</span>{/each}
        </span>
      {/if}
      {#if isHost && (turn.phase === 'draw' || turn.phase === 'choose')}
        <button class="icon" type="button" aria-label={t('skipTurn')} title={t('skipTurn')} onclick={() => act('skip')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></svg>
        </button>
      {/if}
      {#if turn.phase === 'draw' && turn.startsAt}
        <Clock {room} from={turn.startsAt} to={turn.endsAt} />
      {:else if turn.phase === 'choose'}
        <Clock {room} from={turn.endsAt - 15000} to={turn.endsAt} />
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <ewo-settings-button onclick={() => (settingsOpen = true)}></ewo-settings-button>
    </div>
  </header>

  <aside class="side">
    <Players {view} />
  </aside>

  <div class="center">
    <div class="sheet-box">
      <Canvas
        bind:this={canvas}
        {room}
        {turn}
        team={ownTeam}
        drawing={drawingNow}
        {tool}
        {color}
        {size}
        spice={drawingNow ? (turn.spice ?? null) : null}
        oninkused={(n) => (inkUsed = n)}
      >
        {#if turn.phase === 'choose'}
          <div class="overlay">
            {#if isDrawer && turn.choices}
              <div class="choices">
                {#each turn.choices as c, i (c.word)}
                  <button class="btn choice" type="button" onclick={() => act('choose', { index: i })}>
                    <span class="display">{c.word}</span>
                    <span class="meta">{@render dots(c.difficulty)}<span class="mult">{t('multiplier', { n: num(MULTIPLIERS[c.difficulty]) })}</span></span>
                  </button>
                {/each}
              </div>
            {:else if drawer}
              <div class="waiting">
                <Avatar avatar={drawer.avatar} size={64} boil />
                <span class="display">{t('choosing', { name: drawer.name })}</span>
              </div>
            {/if}
          </div>
        {:else if turn.phase === 'reveal'}
          <div class="overlay soft">
            <div class="reveal box">
              <span class="tape">{ended}</span>
              <span class="label">{t('wordWas')}</span>
              <span class="big display hl">{turn.word}</span>
              {#if !turn.guessed}<span class="none">{t('nobodyGotIt')}</span>{/if}
            </div>
          </div>
        {/if}
      </Canvas>
    </div>

    {#if duel && turn.phase === 'reveal' && turn.teams}
      <div class="others">
        {#each turn.teams.filter((x) => x.team !== ownTeam) as x (x.team)}
          <figure class="mini">
            <Canvas {room} {turn} team={x.team} />
            <figcaption><span class="team-tag t{x.team}">{teamName(x.team)}</span>{x.done ? ` +${num(x.points ?? 0)}` : ''}</figcaption>
          </figure>
        {/each}
      </div>
    {/if}

    {#if drawingNow}
      <Dock bind:tool bind:color bind:size spice={turn.spice ?? null} palette={turn.palette ?? null} {inkUsed} onundo={() => canvas?.undo()} onclear={() => canvas?.clear()} />
    {:else if view.me && turn.phase !== 'choose'}
      <div class="reacts">
        {#each view.reactions as e, i (e)}
          <button class="react" type="button" aria-label={t('react', { e })} onclick={() => act('react', { e: i })}>{e}</button>
        {/each}
        {#if !isDrawer}
          <span class="likes">
            <button class="react thumb" type="button" aria-label={t('like')} aria-pressed={turn.like === 1} onclick={() => like(1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9z" /><path d="M7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H19a2 2 0 012 2.3l-1.2 6A2 2 0 0117.8 20H7" /></svg>
            </button>
            <button class="react thumb down" type="button" aria-label={t('dislike')} aria-pressed={turn.like === -1} onclick={() => like(-1)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9z" /><path d="M7 11l4-7c1.5 0 2.5 1 2.2 2.6L12.6 10H19a2 2 0 012 2.3l-1.2 6A2 2 0 0117.8 20H7" /></svg>
            </button>
          </span>
        {/if}
      </div>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}

    <div class="strip"><Players {view} strip /></div>
  </div>

  <section class="talk" onfocusin={focusIn} onfocusout={focusOut}>
    <Chat {room} {view} compact />
  </section>

  {#if !room.live}<p class="offline">{t('reconnecting')}</p>{/if}
</div>

<Settings open={settingsOpen} onclose={() => (settingsOpen = false)} />

<style>
  .stage {
    --top-h: 56px;
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
    min-height: var(--top-h);
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
    font: 600 14px/1.3 var(--ewo-sans);
  }
  .label.inline {
    font-size: 11px;
  }
  .word {
    font-size: 26px;
    line-height: 1;
  }
  .pattern {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 3px;
  }
  .slot,
  .letter {
    display: inline-grid;
    place-items: end center;
    width: clamp(10px, 3vw, 16px);
    height: 22px;
    border-bottom: 2.5px solid var(--ink);
    font: 400 22px/1 var(--display);
  }
  .letter {
    border-bottom-color: var(--good);
  }
  .gap {
    width: 10px;
  }
  .count {
    margin-left: 4px;
    font: 600 12px/1 var(--ewo-mono);
    color: var(--mute);
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    align-self: center;
  }
  .dots i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ink);
    opacity: 0.2;
  }
  .dots i.on {
    opacity: 1;
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
    stroke-linecap: round;
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
  /* The canvas takes the width it can, but never the room the chat needs. */
  .sheet-box {
    --reserve: 330px;
    width: min(100%, calc((var(--vv-h, 100dvh) - var(--reserve)) * 4 / 3));
    min-width: 200px;
    margin: 8px auto 0;
  }
  .drawer .sheet-box {
    --reserve: 360px;
  }
  .typing .sheet-box {
    --reserve: 190px;
  }
  .typing .strip,
  .typing .reacts {
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
    background: rgb(253 253 251 / 0.86);
  }
  .overlay.soft {
    background: rgb(253 253 251 / 0.55);
  }
  .choices {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    width: 100%;
    max-width: 560px;
  }
  .choice {
    flex: 1 1 140px;
    min-width: 0;
    max-width: 100%;
    flex-direction: column;
    gap: 4px;
    min-height: 58px;
    padding: 6px 10px;
    white-space: normal;
  }
  .choice .display {
    max-width: 100%;
    font-size: clamp(20px, 5.4vw, 26px);
    line-height: 1;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mult {
    font: 600 11px/1 var(--ewo-mono);
    color: var(--mute);
  }
  .waiting {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .waiting .display {
    font-size: 28px;
  }
  .reveal {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 22px 22px 14px;
    text-align: center;
    max-width: 92%;
  }
  .reveal .tape {
    position: absolute;
    top: -12px;
    transform: rotate(-3deg);
  }
  .big {
    font-size: clamp(30px, 7vw, 48px);
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  .none {
    font-size: 13px;
    color: var(--mute);
  }

  .reacts {
    display: flex;
    align-items: center;
    gap: 2px;
    justify-content: center;
  }
  .react {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    font-size: 22px;
    -webkit-tap-highlight-color: transparent;
    transition: transform 0.1s;
  }
  .react:active {
    transform: scale(1.25);
  }
  .likes {
    display: flex;
    gap: 2px;
    margin-left: 8px;
    padding-left: 8px;
    border-left: 1.5px solid rgb(43 45 51 / 0.2);
  }
  .thumb svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: var(--ink);
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .thumb.down svg {
    transform: rotate(180deg);
  }
  .thumb[aria-pressed='true'] {
    background: var(--hi);
  }
  .error {
    margin: 0;
    text-align: center;
  }
  .offline {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    margin: 0;
    padding: 6px 12px;
    border-radius: 8px;
    background: var(--ink);
    color: var(--paper);
    font-size: 13px;
  }

  @media (min-width: 900px) {
    .stage {
      grid-template-columns: 230px minmax(0, 1fr) 320px;
      grid-template-rows: auto minmax(0, 1fr);
      grid-template-areas: 'top top top' 'side center talk';
      gap: 16px;
      padding: 0 20px 16px;
    }
    .side {
      display: block;
      grid-area: side;
      min-height: 0;
      overflow-y: auto;
      padding-top: 8px;
    }
    .strip {
      display: none;
    }
    .talk {
      padding-top: 8px;
    }
    .sheet-box {
      --reserve: 210px;
      margin-top: 16px;
    }
    .drawer .sheet-box {
      --reserve: 290px;
    }
    .talk {
      display: flex;
      flex-direction: column;
    }
    .word {
      font-size: 32px;
    }
  }

  .spice {
    align-self: flex-start;
    margin-top: 4px;
    padding: 4px 10px;
    font-size: 11px;
    transform: rotate(-2deg);
  }
  .team-tag {
    display: inline-block;
    padding: 0 6px;
    border-radius: 5px;
    color: #ffffff;
    font-weight: 700;
  }
  .scores {
    display: flex;
    gap: 4px;
  }
  .score {
    padding: 3px 7px;
    border-radius: 6px;
    color: #ffffff;
    font: 700 12px/1.2 var(--ewo-mono);
    font-variant-numeric: tabular-nums;
  }
  .t0 { background: #c9341f; }
  .t1 { background: #2d5bd8; }
  .t2 { background: #8a6d00; }
  .t3 { background: #1f7a45; }
  .others {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .mini {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: min(30%, 150px);
  }
  .mini :global(.sheet::before),
  .mini :global(.sheet::after) {
    display: none;
  }
  .mini figcaption {
    font: 600 12px/1.2 var(--ewo-sans);
  }
</style>
