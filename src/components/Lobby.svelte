<!--
  The lobby: the room's code, link and QR code, who's here (bots too), and the host's settings.
  A setting answers the tap at once and the server's echo takes over once it agrees
  (learnings/ui-preferences.md → "A control answers the tap").
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ApiError, type Config, type Settings, type View } from '../lib/api';
  import type { Avatar as AvatarValue } from '../lib/avatar';
  import { errorText, t, type Key } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';
  import { saveAvatar, saveCustom, savedCustom } from '../lib/session';
  import Avatar from './Avatar.svelte';
  import AvatarMaker from './AvatarMaker.svelte';
  import Qr from './Qr.svelte';

  let { room, view, config }: { room: Room; view: View; config: Config | null } = $props();

  const PRESETS = {
    classic: { rounds: 3, seconds: 80, words: 3, hints: 2 },
    blitz: { rounds: 2, seconds: 45, words: 1, hints: 3 },
  };
  const ROUNDS = $derived(config?.rounds ?? [2, 3, 4, 5, 6, 8, 10]);
  const SECONDS = $derived(config?.seconds ?? [30, 45, 60, 80, 100, 120, 180, 240]);
  const WORDS = $derived(config?.words ?? [1, 2, 3, 4, 5]);
  const HINTS = $derived(config?.hints ?? [0, 1, 2, 3, 4, 5]);
  const PACKS = $derived(config?.packs ?? ['everyday', 'animals', 'food', 'places', 'jobs', 'office', 'sports', 'nature', 'things']);

  let pending: Partial<Settings> = $state({});
  let sending = false;
  let error = $state('');
  let more = $state(false);
  let copied = $state(false);
  let avatarOpen = $state(false);
  let myAvatar: AvatarValue | null = $state(null);
  let customText = $state('');
  let customTimer = 0;

  const isHost = $derived(view.me === view.host);
  const settings: Settings = $derived({ ...view.settings, ...pending });
  const me = $derived(view.players.find((p) => p.id === view.me));
  const hostName = $derived(view.players.find((p) => p.id === view.host)?.name ?? '');
  const link = $derived(`${location.origin}/${view.code}`);
  const bots = $derived(view.players.filter((p) => p.bot).length);

  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

  // The server agrees: its value takes over.
  $effect(() => {
    const server = view.settings;
    const left = Object.fromEntries(Object.entries(pending).filter(([k, v]) => !same(server[k as keyof Settings], v)));
    if (Object.keys(left).length !== Object.keys(pending).length) pending = left;
  });

  function change(patch: Partial<Settings>) {
    if (!isHost) return;
    if (patch.mode && patch.mode !== settings.mode) Object.assign(patch, PRESETS[patch.mode]);
    pending = { ...pending, ...patch };
    void flush();
  }

  async function flush() {
    if (sending) return;
    const body = { ...pending };
    if (!Object.keys(body).length) return;
    sending = true;
    error = '';
    try {
      await room.act('settings', body);
    } catch (e) {
      pending = {};
      error = errorText(e instanceof ApiError ? e.code : 'other');
    } finally {
      sending = false;
    }
    if (Object.keys(pending).length && !same(pending, body)) void flush();
  }

  function togglePack(pack: string) {
    const packs = settings.packs.includes(pack as never) ? settings.packs.filter((p) => p !== pack) : [...settings.packs, pack];
    change({ packs: PACKS.filter((p) => packs.includes(p as never)) as Settings['packs'] });
  }

  function typeCustom(text: string) {
    customText = text;
    saveCustom(text);
    clearTimeout(customTimer);
    customTimer = window.setTimeout(() => change({ custom: text }), 700);
  }

  onMount(() => {
    // The host's own words from last time come along.
    customText = view.settings.custom;
    const saved = savedCustom();
    if (isHost && !view.settings.custom && saved) {
      customText = saved;
      change({ custom: saved });
    }
  });

  async function act(action: string, body?: unknown) {
    error = '';
    try {
      await room.act(action, body);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      // The link is on the page to select by hand.
    }
  }

  function changeAvatar(next: AvatarValue) {
    myAvatar = next;
    saveAvatar(next);
    void act('avatar', { avatar: next });
  }
</script>

{#snippet choice(label: string, on: boolean, pick: () => void, disabled = false)}
  <button class="chip" type="button" aria-pressed={on} disabled={!isHost || disabled} onclick={pick}>{label}</button>
{/snippet}

<div class="lobby">
  <section class="box room">
    <div class="code-side">
      <span class="label">{t('code')}</span>
      <span class="code display">{view.code}</span>
      <span class="url">{link.replace(/^https?:\/\//, '')}</span>
      <div class="links">
        <button class="btn small" type="button" onclick={copy}>{copied ? t('copied') : t('copyLink')}</button>
        <a class="btn small quiet" href="/{view.code}/screen" target="_blank" rel="noopener" title={t('bigScreenHint')}>{t('bigScreen')}</a>
      </div>
    </div>
    <div class="qr"><Qr url={link} /></div>
  </section>

  <section class="players">
    <h2 class="head"><span>{t('players')}</span><span class="label">{t('playersCount', { n: view.players.length, max: 20 })}</span></h2>
    <ul>
      {#each view.players as p (p.id)}
        <li class:off={!p.online}>
          {#if p.id === view.me}
            <button class="face" type="button" aria-label={t('changeAvatar')} onclick={() => (avatarOpen = true)}>
              <Avatar avatar={myAvatar ?? p.avatar} size={52} />
              <span class="edit" aria-hidden="true">✎</span>
            </button>
          {:else}
            <span class="face"><Avatar avatar={p.avatar} size={52} /></span>
          {/if}
          <span class="name">{p.name}</span>
          <span class="tags">
            {#if p.id === view.host}<span class="tag lead">{t('leads')}</span>{/if}
            {#if p.id === view.me}<span class="tag">{t('you')}</span>{/if}
            {#if p.bot}<span class="tag bot">{t('bot')}</span>{/if}
          </span>
          {#if isHost && p.id !== view.me && !p.bot}
            <button class="kick" type="button" aria-label={t('kick', { name: p.name })} onclick={() => act('kick', { player: p.id })}>×</button>
          {/if}
        </li>
      {/each}
    </ul>
    {#if isHost}
      <div class="bots">
        <button class="chip" type="button" onclick={() => act('bot', { add: true })} disabled={bots >= 8}>+ {t('addBot')}</button>
        {#if bots}<button class="chip" type="button" onclick={() => act('bot', { add: false })}>− {t('removeBot')}</button>{/if}
        <span class="hint">{t('botsHint')}</span>
      </div>
    {/if}
  </section>

  <section class="box settings" aria-labelledby="game-h">
    <h2 class="head" id="game-h"><span>{t('game')}</span>{#if !isHost}<span class="label">{t('hostSets', { name: hostName })}</span>{/if}</h2>

    <div class="row">
      <span class="name">{t('mode')}</span>
      <div class="chips">
        {#each ['classic', 'blitz'] as const as mode (mode)}
          {@render choice(t(`mode_${mode}`), settings.mode === mode, () => change({ mode }))}
        {/each}
      </div>
      <p class="hint wide">{t(`mode_${settings.mode}_hint`)}</p>
    </div>
    <div class="row">
      <span class="name">{t('rounds')}</span>
      <div class="chips">
        {#each ROUNDS as n (n)}{@render choice(String(n), settings.rounds === n, () => change({ rounds: n }))}{/each}
      </div>
    </div>
    <div class="row">
      <span class="name">{t('seconds')}</span>
      <div class="chips">
        {#each SECONDS as n (n)}{@render choice(t('secondsUnit', { n }), settings.seconds === n, () => change({ seconds: n }))}{/each}
      </div>
    </div>
    <div class="row">
      <span class="name">{t('words')}</span>
      <div class="chips">
        {#each WORDS as n (n)}{@render choice(String(n), settings.words === n, () => change({ words: n }))}{/each}
      </div>
    </div>
    <div class="row">
      <span class="name">{t('hints')}</span>
      <div class="chips">
        {#each HINTS as n (n)}{@render choice(String(n), settings.hints === n, () => change({ hints: n }))}{/each}
      </div>
    </div>

    {#if more}
      <div class="row">
        <span class="name">{t('wordMode')}</span>
        <div class="chips">
          {#each ['normal', 'hidden', 'combo'] as const as m (m)}
            {@render choice(t(`wordMode_${m}`), settings.wordMode === m, () => change({ wordMode: m }))}
          {/each}
        </div>
        <p class="hint wide">{t(`wordMode_${settings.wordMode}_hint`)}</p>
      </div>
      <div class="row">
        <span class="name">{t('wordLang')}</span>
        <div class="chips">
          {#each ['de', 'en'] as const as lang (lang)}
            {@render choice(t(`lang_${lang}`), settings.lang === lang, () => change({ lang }))}
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="name">{t('difficulty')}</span>
        <div class="chips">
          {#each ['mixed', 'easy', 'medium', 'hard'] as const as d (d)}
            {@render choice(t(`difficulty_${d}`), settings.difficulty === d, () => change({ difficulty: d }))}
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="name">{t('packs')}</span>
        <div class="chips">
          {@render choice(t('allPacks'), settings.packs.length === PACKS.length, () => change({ packs: (settings.packs.length === PACKS.length ? [] : [...PACKS]) as Settings['packs'] }))}
          {#each PACKS as pack (pack)}
            {@render choice(t(`pack_${pack}` as Key), settings.packs.includes(pack as never), () => togglePack(pack), settings.onlyCustom)}
          {/each}
        </div>
      </div>
      <div class="row">
        <span class="name">{t('custom')}</span>
        {#if isHost}
          <div class="custom">
            <textarea class="input area" rows="3" placeholder={t('customPlaceholder')} value={customText} oninput={(e) => typeCustom(e.currentTarget.value)}></textarea>
            <p class="hint">{t('customHint')} {t('customCount', { n: settings.customCount })}</p>
            <div class="switch">
              <ewo-switch checked={settings.onlyCustom} aria-label={t('onlyCustom')} onchange={(e) => change({ onlyCustom: e.detail.checked })}></ewo-switch>
              <span aria-hidden="true">{t('onlyCustom')}</span>
            </div>
          </div>
        {:else}
          <p class="hint">{settings.customCount ? t('customSecret', { name: hostName, n: settings.customCount }) : '–'}</p>
        {/if}
      </div>
      <div class="row">
        <span class="name">{t('nearMiss')}</span>
        <ewo-switch checked={settings.nearMiss} disabled={!isHost} aria-label={t('nearMiss')} onchange={(e) => change({ nearMiss: e.detail.checked })}></ewo-switch>
      </div>
    {/if}
    <button class="btn quiet more" type="button" aria-expanded={more} onclick={() => (more = !more)}>{more ? t('less') : t('more')}</button>
  </section>

  <div class="go">
    {#if isHost}
      <button class="btn primary block" type="button" disabled={view.players.length < 2} onclick={() => act('start')}>{t('start')}</button>
      {#if view.players.length < 2}<p class="hint center">{t('startNeeds')}</p>{/if}
    {:else}
      <p class="waiting display">{t('waitingFor', { name: hostName })}</p>
    {/if}
    {#if error}<p class="error center" role="alert">{error}</p>{/if}
  </div>
</div>

{#if me}
  <ewo-sheet open={avatarOpen} label={t('changeAvatar')} oncancel={() => (avatarOpen = false)} onclose={() => (avatarOpen = false)}>
    <span slot="heading">{t('changeAvatar')}</span>
    {#if avatarOpen}
      <div class="sheet-maker">
        <AvatarMaker avatar={myAvatar ?? me.avatar} onchange={changeAvatar} />
        <button class="btn primary block" type="button" onclick={() => (avatarOpen = false)}>{t('done')}</button>
      </div>
    {/if}
  </ewo-sheet>
{/if}

<style>
  .lobby {
    display: grid;
    gap: 22px;
    max-width: 980px;
    margin: 12px auto 0;
  }
  @media (min-width: 900px) {
    .lobby {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
      align-items: start;
    }
    .room,
    .players {
      grid-column: 1;
    }
    .settings {
      grid-column: 2;
      grid-row: 1 / span 3;
    }
    .go {
      grid-column: 1;
    }
  }
  .room {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px;
  }
  .code-side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .code {
    font-size: 54px;
    line-height: 0.95;
    letter-spacing: 0.06em;
  }
  .url {
    font: 500 12px/1.3 var(--ewo-mono);
    color: var(--mute);
    overflow-wrap: anywhere;
    user-select: all;
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .qr {
    flex: none;
    width: 110px;
    margin-left: auto;
    padding: 6px;
    background: #ffffff;
    border: 2px solid var(--ink);
    border-radius: 6px;
  }
  @media (max-width: 400px) {
    .qr {
      width: 84px;
    }
    .code {
      font-size: 46px;
    }
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    margin: 0 0 10px;
    font: 700 15px/1.2 var(--ewo-sans);
  }
  .players ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
    gap: 14px 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .players li {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    text-align: center;
  }
  .players li.off {
    opacity: 0.5;
  }
  .face {
    position: relative;
    display: inline-grid;
    padding: 0;
    border: 0;
    background: none;
    border-radius: 50%;
  }
  button.face:focus-visible {
    outline: 3px solid var(--tape-2);
    outline-offset: 3px;
  }
  .edit {
    position: absolute;
    right: -6px;
    bottom: -2px;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--hi);
    box-shadow: 0 0 0 1.5px var(--ink);
    font-size: 12px;
  }
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 600 13px/1.2 var(--ewo-sans);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 3px;
    min-height: 16px;
  }
  .tag {
    padding: 1px 6px;
    border-radius: 6px;
    background: rgb(43 45 51 / 0.08);
    font: 600 10.5px/1.4 var(--ewo-sans);
    color: var(--ink-2);
  }
  .tag.lead {
    background: var(--hi);
    color: var(--hi-ink);
  }
  .tag.bot {
    background: rgb(79 195 185 / 0.3);
  }
  .kick {
    position: absolute;
    top: -6px;
    right: calc(50% - 38px);
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1.5px solid var(--ink);
    border-radius: 50%;
    background: var(--card);
    font: 700 15px/1 var(--ewo-sans);
  }
  .bots {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 14px;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--mute);
  }
  .hint.center,
  .error.center {
    text-align: center;
  }
  .settings {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 6px 12px;
    align-items: center;
  }
  .row .name {
    font: 600 14px/1.2 var(--ewo-sans);
    white-space: normal;
    text-align: left;
  }
  .row .wide {
    grid-column: 2;
  }
  @media (max-width: 520px) {
    .row {
      grid-template-columns: 1fr;
    }
    .row .wide {
      grid-column: 1;
    }
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .custom {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .area {
    min-height: 84px;
    padding: 10px 12px;
    resize: vertical;
    font-weight: 500;
  }
  .switch {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
  }
  .more {
    align-self: flex-start;
  }
  .go {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .waiting {
    margin: 0;
    text-align: center;
    font-size: 26px;
  }
  .sheet-maker {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-top: 12px;
  }
</style>
