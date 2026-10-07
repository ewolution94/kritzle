<!--
  Stille Post: write a phrase, draw the phrase you're handed, describe the drawing you're handed,
  and so on, everyone at once on a clock; nobody sees anyone else's work until the end. Then the
  host steps through each chain, entry by entry, while everyone watches. The same stage as a turn
  (Turn.svelte): it fills the visible screen and follows visualViewport.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { lockScroll } from '../../vendor/ewo/elements/scroll-lock.js';
  import { api, ApiError, type ChainEntry, type View } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import type { Op } from '../lib/ink';
  import type { Room } from '../lib/room.svelte';
  import Avatar from './Avatar.svelte';
  import Canvas, { type Tool } from './Canvas.svelte';
  import Clock from './Clock.svelte';
  import Dock from './Dock.svelte';
  import Picture from './Picture.svelte';
  import Players from './Players.svelte';
  import Settings from './Settings.svelte';

  let { room, view }: { room: Room; view: View } = $props();

  let tool: Tool = $state('pen');
  let color = $state(0);
  let size = $state(1);
  let canvas: Canvas | undefined = $state();
  let text = $state('');
  let error = $state('');
  let settingsOpen = $state(false);
  let typing = $state(false);
  let promptOps: Op[] | null = $state(null);
  let promptFor = -1;
  let chains: { owner: string; entries: ChainEntry[] }[] | null = $state(null);
  let list: HTMLOListElement | undefined = $state();
  let stage: HTMLDivElement;

  const turn = $derived(view.turn!);
  const isHost = $derived(view.me === view.host);
  const names = $derived(new Map(view.players.map((p) => [p.id, p])));
  const players = $derived(view.players.length);
  const doneCount = $derived(turn.done?.length ?? 0);
  const drawingNow = $derived(turn.phase === 'tell' && turn.stepKind === 'draw' && !turn.myDone && Boolean(view.me));
  type Chain = { owner: string; entries: ChainEntry[] };
  const shown = $derived(entriesUpTo(chains, turn.show ?? null));

  function entriesUpTo(all: Chain[] | null, show: { chain: number; entry: number } | null): ChainEntry[] {
    if (!all || !show) return [];
    return all[show.chain]?.entries.slice(0, show.entry + 1) ?? [];
  }
  const owner = $derived(turn.show ? names.get(turn.show.owner) : null);

  // A new step: an empty field, and the drawing to describe fetched once.
  $effect(() => {
    void turn.step;
    text = '';
  });
  $effect(() => {
    if (turn.phase === 'tell' && turn.promptDrawing && room.seat && promptFor !== turn.n) {
      promptFor = turn.n;
      promptOps = null;
      api.prompt(room.seat).then((p) => (promptOps = p.ops), () => (promptOps = []));
    }
  });
  $effect(() => {
    if (turn.phase === 'showcase' && !chains) api.chains(view.code).then((c) => (chains = c.chains), () => {});
  });
  // The newest entry scrolls into view.
  $effect(() => {
    void shown.length;
    void tick().then(() => list?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  });

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

  function send(event: SubmitEvent) {
    event.preventDefault();
    if (text.trim()) void act('tell', { text: text.trim() });
  }

  async function finished() {
    await room.settle();
    void act('done');
  }

  function focusIn(event: FocusEvent) {
    if ((event.target as HTMLElement).matches('input') && matchMedia('(pointer: coarse)').matches) typing = true;
  }
</script>

<div class="stage" class:typing class:drawing={drawingNow} bind:this={stage}>
  <header class="top">
    <div class="status">
      <span class="label">{t('mode_telephone')}{turn.phase === 'tell' ? ` · ${t('stepOf', { n: (turn.step ?? 0) + 1, total: turn.steps ?? 1 })}` : ''}</span>
      <span class="what">
        {#if turn.phase === 'showcase'}{t('chainOf', { name: owner?.name ?? '' })}
        {:else if turn.myDone}{t('waitOthers', { n: doneCount, total: players })}
        {:else if turn.stepKind === 'write'}{t('writeTask')}
        {:else if turn.stepKind === 'draw'}{t('drawTask')}
        {:else}{t('describeTask')}{/if}
      </span>
    </div>
    <div class="end">
      {#if isHost && turn.phase === 'tell'}
        <button class="icon" type="button" aria-label={t('skipTurn')} title={t('skipTurn')} onclick={() => act('skip')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></svg>
        </button>
      {/if}
      {#if turn.phase === 'tell' && turn.startsAt}
        {#key turn.step}<Clock {room} from={turn.startsAt} to={turn.endsAt} />{/key}
      {/if}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <ewo-settings-button onclick={() => (settingsOpen = true)}></ewo-settings-button>
    </div>
  </header>

  <div class="center" onfocusin={focusIn} onfocusout={() => (typing = false)}>
    {#if turn.phase === 'showcase'}
      <ol class="chain" bind:this={list}>
        {#each shown as e, i (i)}
          {@const p = names.get(e.player)}
          <li class:fresh={i === shown.length - 1} class={e.kind}>
            <span class="by"><Avatar avatar={p?.avatar ?? [0, 0, 0, 0, 0]} size={28} /> {p?.name ?? ''}</span>
            {#if e.kind === 'text'}
              <p class="said display">„{e.text}“</p>
            {:else}
              <div class="pic"><Picture ops={e.ops ?? []} label={t('by', { name: p?.name ?? '' })} /></div>
            {/if}
          </li>
        {/each}
      </ol>
      <div class="controls">
        {#if isHost}
          <button class="btn" type="button" onclick={() => act('prev')}>{t('back')}</button>
          <button class="btn primary" type="button" onclick={() => act('next')}>{t('showNext')}</button>
        {:else}
          <p class="hint">{t('hostShows', { name: names.get(view.host)?.name ?? '' })}</p>
        {/if}
      </div>
      <div class="reacts">
        {#each view.reactions as e, i (e)}
          <button class="react" type="button" aria-label={t('react', { e })} onclick={() => act('react', { e: i })}>{e}</button>
        {/each}
      </div>
    {:else if turn.stepKind === 'draw'}
      <p class="prompt box"><span class="label">{t('drawThis')}</span> <span class="display">„{turn.prompt ?? ''}“</span></p>
      <div class="sheet-box">
        <Canvas bind:this={canvas} {room} {turn} drawing={drawingNow} {tool} {color} {size} />
      </div>
      {#if drawingNow}
        <Dock bind:tool bind:color bind:size onundo={() => canvas?.undo()} onclear={() => canvas?.clear()} />
        <button class="btn primary" type="button" onclick={finished}>{t('doneDrawing')}</button>
      {/if}
    {:else}
      {#if turn.stepKind === 'describe'}
        <div class="sheet-box">
          {#if promptOps}<Picture ops={promptOps} label={t('describeTask')} />{:else}<div class="loading box"></div>{/if}
        </div>
      {/if}
      {#if !turn.myDone && view.me}
        <form class="tell" onsubmit={send}>
          <input
            class="input"
            bind:value={text}
            maxlength="80"
            autocomplete="off"
            enterkeyhint="send"
            placeholder={turn.stepKind === 'write' ? t('writePlaceholder') : t('describePlaceholder')}
            aria-label={turn.stepKind === 'write' ? t('writeTask') : t('describeTask')}
          />
          <button class="btn primary" type="submit">{t('send')}</button>
        </form>
        {#if turn.stepKind === 'write' && turn.suggestion}
          <button class="btn quiet" type="button" onclick={() => (text = turn.suggestion ?? '')}>{t('suggest', { word: turn.suggestion })}</button>
        {/if}
      {:else if turn.myText}
        <p class="sent box">„{turn.myText}“</p>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>

  <div class="strip"><Players {view} strip /></div>

  {#if !room.live}<p class="offline">{t('reconnecting')}</p>{/if}
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
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 8px;
    padding: 0 12px max(10px, env(safe-area-inset-bottom));
    background-color: var(--paper);
    background-image: linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px);
    background-size: 16px 16px;
    background-position: -1px -1px;
    overflow: hidden;
  }
  .top {
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
    font: 600 15px/1.3 var(--ewo-sans);
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
  .center {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 2px;
    width: min(100%, 760px);
    margin: 0 auto;
  }
  .sheet-box {
    width: min(100%, calc((var(--vv-h, 100dvh) - 330px) * 4 / 3));
    min-width: 200px;
    margin: 4px auto 0;
  }
  .typing .sheet-box {
    width: min(100%, calc((var(--vv-h, 100dvh) - 200px) * 4 / 3));
  }
  .loading {
    aspect-ratio: 4 / 3;
  }
  .prompt {
    margin: 0;
    padding: 8px 12px;
    text-align: center;
  }
  .prompt .display {
    font-size: 24px;
  }
  .tell {
    display: flex;
    gap: 8px;
  }
  .tell .input {
    flex: 1;
    min-width: 0;
  }
  .sent {
    margin: 0;
    padding: 12px;
    text-align: center;
    font: 400 24px/1.2 var(--display);
  }
  .chain {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chain li {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chain li.fresh {
    animation: pop-in 0.45s var(--ewo-ease-spring);
  }
  @keyframes pop-in {
    from {
      transform: translateY(12px) scale(0.97);
      opacity: 0;
    }
  }
  .by {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 600 13px/1.2 var(--ewo-sans);
  }
  .said {
    margin: 0;
    padding: 10px 14px;
    border: 2px solid var(--ink);
    border-radius: 14px 14px 14px 4px;
    background: var(--card);
    font-size: 26px;
    line-height: 1.15;
    align-self: flex-start;
  }
  .pic {
    width: min(100%, 420px);
  }
  .controls {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  .hint {
    margin: 0;
    text-align: center;
    color: var(--mute);
    font-size: 13px;
  }
  .reacts {
    display: flex;
    justify-content: center;
    gap: 2px;
  }
  .react {
    width: 40px;
    height: 40px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    font-size: 22px;
  }
  .error {
    margin: 0;
    text-align: center;
  }
  .typing .strip {
    display: none;
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
      padding: 0 20px 16px;
    }
  }
</style>
