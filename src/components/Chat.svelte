<!--
  The chat, where guessing happens. A right guess never shows: the line says who got it. After
  that, a player's messages reach only those who know (marked here); a near miss nudges only the
  guesser. The field says which of these you're in.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import { ApiError, type ChatLine, type View } from '../lib/api';
  import { errorText, t } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';

  let { room, view, compact = false }: { room: Room; view: View; compact?: boolean } = $props();

  let text = $state('');
  let error = $state('');
  let list: HTMLOListElement;
  let errorTimer = 0;

  const names = $derived(new Map(view.players.map((p) => [p.id, p.name])));
  const turn = $derived(view.turn);
  const knows = $derived(Boolean(turn && view.me && (turn.drawer === view.me || view.players.find((p) => p.id === view.me)?.guessed)));
  const placeholder = $derived(view.phase === 'draw' ? (knows ? t('chatKnowers') : t('guessHere')) : t('chatPlaceholder'));
  const name = (id: string) => names.get(id) ?? '…';

  // New lines scroll into view, unless you've scrolled up to read.
  $effect(() => {
    void room.chat.length;
    if (!list) return;
    const near = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
    if (near) void tick().then(() => list && (list.scrollTop = list.scrollHeight));
  });

  async function send(event: SubmitEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    text = '';
    try {
      await room.act('chat', { text: message });
    } catch (e) {
      text = message;
      error = errorText(e instanceof ApiError ? e.code : 'other');
      clearTimeout(errorTimer);
      errorTimer = window.setTimeout(() => (error = ''), 2500);
    }
  }

  function line(l: ChatLine) {
    switch (l.kind) {
      case 'guessed':
        return t('chat_guessed', { name: name(l.player) });
      case 'close':
        return t('chat_close', { text: l.text });
      case 'half':
        return t('chat_half', { text: l.text });
      case 'join':
        return t('chat_join', { name: l.text || name(l.player) });
      case 'leave':
        return t('chat_leave', { name: l.text || name(l.player) });
      case 'word':
        return t('chat_word', { text: l.text });
      case 'skip':
        return t('chat_skip', { name: name(l.player) });
      case 'host':
        return t('chat_host', { name: name(l.player) });
      default:
        return l.text;
    }
  }
</script>

<div class="chat" class:compact>
  <ol bind:this={list} aria-live="polite">
    {#each room.chat as l (l.id)}
      <li class={l.kind} class:secret={l.private && l.kind === 'msg'}>
        {#if l.kind === 'msg'}
          <b>{name(l.player)}:</b> {l.text}
          {#if l.private}<span class="only">{t('chatOnly')}</span>{/if}
        {:else if l.kind === 'guessed'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
          {line(l)}
        {:else}
          {line(l)}
        {/if}
      </li>
    {/each}
  </ol>
  {#if view.me}
    <form onsubmit={send}>
      <input
        class="input"
        class:knows
        bind:value={text}
        maxlength="100"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="send"
        {placeholder}
        aria-label={placeholder}
      />
      <button class="btn send" type="submit" aria-label={t('send')}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h14" /><path d="M13 6l6 6-6 6" /></svg>
      </button>
    </form>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    height: 100%;
  }
  ol {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0;
    padding: 2px;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    font-size: 14px;
    line-height: 1.35;
  }
  li {
    padding: 2px 6px;
    overflow-wrap: anywhere;
    border-radius: 5px;
  }
  li b {
    font-weight: 700;
  }
  li.secret {
    background: rgb(200 245 60 / 0.25);
  }
  .only {
    margin-left: 4px;
    font-size: 11px;
    color: var(--mute);
  }
  li.guessed {
    display: flex;
    align-items: center;
    gap: 5px;
    background: var(--hi-soft);
    font-weight: 700;
  }
  li.guessed svg {
    flex: none;
    width: 15px;
    height: 15px;
    fill: none;
    stroke: var(--ink);
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  li.close,
  li.half {
    background: rgb(255 143 112 / 0.3);
    font-weight: 600;
  }
  li.word {
    font-weight: 700;
    border-top: 1.5px dashed rgb(43 45 51 / 0.25);
    border-radius: 0;
    margin-top: 2px;
    padding-top: 5px;
  }
  li.join,
  li.leave,
  li.skip,
  li.host {
    color: var(--mute);
    font-style: italic;
    font-size: 13px;
  }
  form {
    display: flex;
    gap: 6px;
  }
  form .input {
    flex: 1;
    min-width: 0;
    min-height: 46px;
    font-weight: 500;
  }
  form .input.knows {
    background: #f6ffe0;
  }
  .send {
    flex: none;
    width: 50px;
    min-height: 46px;
    padding: 0;
    background: var(--hi);
  }
  .send svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .error {
    margin: 0;
  }
  .compact ol {
    font-size: 13.5px;
  }
</style>
