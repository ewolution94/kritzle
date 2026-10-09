<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, CODE, type Seat } from './lib/api';
  import { Room } from './lib/room.svelte';
  import { forgetSeat, saveName, savedSeat, saveSeat } from './lib/session';
  import { loadCensus } from './lib/census';
  import Bar from './components/Bar.svelte';
  import Home from './components/Home.svelte';
  import Join from './components/Join.svelte';
  import Game from './components/Game.svelte';
  import Footer from './components/Footer.svelte';
  import Screen from './components/Screen.svelte';

  // The whole app is one page. "/" is the start; "/KXPT" is a room, and the link people share;
  // "/KXPT/screen" is that room on the big screen.
  let path = $state(location.pathname);
  const code = $derived(codeFrom(path));
  const screenCode = $derived(screenFrom(path));
  let room: Room | null = $state.raw(null);
  /** Arriving at a room with a saved seat: reclaiming it before anything shows. */
  let reclaiming = $state(false);
  /** In a turn: the turn's own stage fills the screen, without the bar and footer. */
  const playing = $derived(inTurn(room));

  function inTurn(r: Room | null) {
    return ['choose', 'draw', 'forge', 'vote', 'unmask', 'tell', 'showcase', 'reveal'].includes(r?.view?.phase ?? '');
  }

  function codeFrom(p: string) {
    const segment = p.replace(/^\/+|\/+$/g, '').toUpperCase();
    return CODE.test(segment) ? segment : null;
  }

  function screenFrom(p: string) {
    const match = /^\/([a-z]{4})\/screen\/?$/i.exec(p);
    return match && CODE.test(match[1].toUpperCase()) ? match[1].toUpperCase() : null;
  }

  function go(to: string, replace = false) {
    if (location.pathname !== to) history[replace ? 'replaceState' : 'pushState'](null, '', to);
    path = to;
  }

  /**
   * Into a room: its stream opens and the screen changes once the first view is there, so the lobby
   * shows whole. Until then the button that asked holds (Folio's track()); `signal` gives up.
   */
  async function enter(seat: Seat, signal?: AbortSignal) {
    const next = new Room(seat.code, seat);
    next.connect();
    try {
      await next.ready(signal);
    } catch (error) {
      next.close();
      throw error;
    }
    saveSeat(seat);
    room?.close();
    room = next;
    go(`/${seat.code}`);
  }

  function leaveRoom() {
    if (room) forgetSeat(room.code);
    room?.close();
    room = null;
    go('/');
  }

  /** Removed from a room (kicked, or gone too long in the lobby): drop the seat and ask for a name again. */
  function rejoin() {
    if (room) forgetSeat(room.code);
    room?.close();
    room = null;
  }

  /** Coming back to a room's link: take the saved seat again (the server checks it). */
  async function reclaim(c: string) {
    const seat = savedSeat(c);
    if (!seat) return;
    reclaiming = true;
    try {
      const ready = new AbortController();
      const timer = setTimeout(() => ready.abort(), 15_000);
      await enter(await api.join(c, '', null, seat.token, undefined, ready.signal), ready.signal).finally(() => clearTimeout(timer));
    } catch (error) {
      if (error instanceof ApiError && error.code !== 'offline') forgetSeat(c);
    } finally {
      reclaiming = false;
    }
  }

  $effect(() => {
    // Leaving a room by navigating (back button) closes its stream.
    if (room && room.code !== code) {
      room.close();
      room = null;
    }
    if (code && !room && !reclaiming) void reclaim(code);
  });

  /** The connection, for the pill: quiet while a button already says it (New game, Play). */
  const connection = $derived(connectionOf(room, reclaiming));
  function connectionOf(r: Room | null, coming: boolean) {
    if (coming) return 'connecting';
    if (!r || r.live) return 'online';
    return r.wasLive ? 'reconnecting' : 'connecting';
  }

  onMount(() => {
    // An unknown path (an old link, a typo) is the start page.
    if (!code && !screenCode && path !== '/') go('/', true);
    const onPop = () => (path = location.pathname);
    addEventListener('popstate', onPop);
    loadCensus();
    return () => removeEventListener('popstate', onPop);
  });
</script>

{#if screenCode}
  {#key screenCode}
    <Screen code={screenCode} />
  {/key}
{:else}
<!-- A turn has its own stage (Turn.svelte) that fills the screen. -->
{#if !playing}<Bar code={room ? room.code : null} />{/if}

<main>
  {#if room}
    <Game {room} onleave={leaveRoom} onrejoin={rejoin} />
  {:else if code}
    {#if !reclaiming}
      <Join
        {code}
        onjoin={async (seat, name, signal) => {
          saveName(name);
          await enter(seat, signal);
        }}
        onback={() => go('/')}
      />
    {/if}
  {:else}
    <Home
      oncreate={async (seat, name, signal) => {
        saveName(name);
        await enter(seat, signal);
      }}
      onjoin={(c) => go(`/${c}`)}
    />
  {/if}
</main>

{#if !playing}<Footer />{/if}

<!-- A room that's gone (a deploy, or forgotten) closed its stream on purpose: no pill, nothing to reconnect. -->
{#if room?.view?.phase !== 'gone'}
  <ewo-connection class="connection" state={connection} class:in-turn={playing}></ewo-connection>
{/if}
{/if}

<style>
  main {
    position: relative;
    z-index: 1;
    max-width: var(--page);
    min-height: calc(100dvh - var(--bar-h) - 120px);
    margin: 0 auto;
    padding: 8px var(--gutter) 48px;
  }

  /* The connection pill (Folio's <ewo-connection>): under the bar, or at the top of a turn's stage. */
  .connection {
    --ewo-connection-top: calc(env(safe-area-inset-top, 0px) + var(--bar-h) + 8px);
    --ewo-connection-bg: var(--ink);
    --ewo-connection-fg: var(--paper);
    --ewo-connection-font: var(--ewo-sans);
  }
  .connection.in-turn {
    --ewo-connection-top: calc(env(safe-area-inset-top, 0px) + 8px);
  }

  /* In the browser (not installed), Safari's toolbar floats over the bottom of the page. */
  @media not (display-mode: standalone) {
    @supports (-webkit-touch-callout: none) {
      main {
        padding-bottom: 96px;
      }
    }
  }
</style>
