<!--
  Settings, the family's way (plans/settings-alignment.md): Folio's ewo-sheet, opened from the
  bar's ewo-settings-button, with General first. Kritzle is light only (plans/kritzle.md), so
  General is the language alone; the game's own settings live in the lobby, with the host.

  During a game (`room` given) it opens with "This game" first: the host can end it for everyone,
  anyone can leave, each after a second tap that says what it does (development/plans/end-game.md).
-->
<script lang="ts">
  import { themeShift } from '../../vendor/ewo/elements/theme-shift.js';
  import { ApiError } from '../lib/api';
  import { errorText, i18n, setLanguage, systemLang, t, type LangChoice } from '../lib/i18n.svelte';
  import type { Room } from '../lib/room.svelte';
  import { play, setSound, sound } from '../lib/sound.svelte';
  import { actAt } from '../lib/waits';

  let {
    open,
    onclose,
    room = null,
    onleave,
  }: { open: boolean; onclose: () => void; room?: Room | null; onleave?: (from: Event) => Promise<void> } = $props();

  const view = $derived(room?.view ?? null);
  const isHost = $derived(Boolean(view && view.me === view.host));
  const hostName = $derived(view?.players.find((p) => p.id === view.host)?.name ?? '');
  /** Which of the two waits for its second tap. */
  let sure: 'end' | 'leave' | null = $state(null);
  let error = $state('');
  $effect(() => {
    if (!open) {
      sure = null;
      error = '';
    }
  });

  async function end(from: Event) {
    error = '';
    try {
      await actAt(room!, 'end', undefined, from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  async function leave(from: Event) {
    error = '';
    try {
      await onleave?.(from);
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }

  // The content stays until the sheet's exit animation is over (its close event), or the sheet
  // slides out as a header-only box.
  let shown = $state(false);
  $effect(() => {
    if (open) shown = true;
  });
  function closed() {
    shown = false;
    onclose();
  }

  /**
   * The picked control updates at once; the page changes under themeShift's veil when it really
   * changes, and at once when it doesn't (System while the system already shows that language).
   */
  function pickLanguage(next: LangChoice) {
    if (next === i18n.choice) return;
    const shows = next === 'system' ? systemLang() : next;
    if (shows === i18n.lang) setLanguage(next);
    else themeShift(() => setLanguage(next));
  }
</script>

<ewo-sheet {open} label={t('settings')} oncancel={onclose} onclose={closed}>
  <span slot="heading">{t('settings')}</span>
  {#if shown}
    {#if room && view}
      <section class="game">
        <h3 class="label">{t('thisGame')}</h3>
        {#if sure === 'end'}
          <p class="sure">{t('endSure')}</p>
          <div class="pair">
            <button class="btn danger" type="button" onclick={end}>{t('endYes')}</button>
            <button class="btn" type="button" onclick={() => (sure = null)}>{t('keepPlaying')}</button>
          </div>
        {:else if sure === 'leave'}
          <p class="sure">{isHost ? t('leaveSureHost') : t('leaveSure')}</p>
          <div class="pair">
            <button class="btn danger" type="button" onclick={leave}>{t('leaveYes')}</button>
            <button class="btn" type="button" onclick={() => (sure = null)}>{t('keepPlaying')}</button>
          </div>
        {:else}
          <div class="pair">
            {#if isHost}
              <button class="btn" type="button" onclick={() => (sure = 'end')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                {t('endGame')}
              </button>
            {/if}
            <button class="btn quiet" type="button" onclick={() => (sure = 'leave')}>{t('leaveGame')}</button>
          </div>
          {#if !isHost}<p class="hint">{t('endHint', { name: hostName })}</p>{/if}
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </section>
    {/if}
    <section>
      <h3 class="label">{t('general')}</h3>
      <div class="row">
        <span class="name">{t('language')}</span>
        <ewo-segmented stretch value={i18n.choice} label={t('language')} onchange={(e) => pickLanguage(e.detail.value as LangChoice)}>
          <option value="system">{t('langSystem')}</option>
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </ewo-segmented>
      </div>
    </section>
    <section>
      <h3 class="label">Kritzle</h3>
      <div class="row">
        <span class="name">{t('soundsHint')}</span>
        <ewo-switch
          checked={sound.on}
          aria-label={t('sounds')}
          onchange={(e) => {
            setSound(e.detail.checked);
            if (e.detail.checked) play.guessed();
          }}
        ></ewo-switch>
      </div>
    </section>
  {/if}
</ewo-sheet>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-bottom: 8px;
  }
  h3 {
    margin: 0;
  }
  .game {
    padding-bottom: 16px;
    margin-bottom: 4px;
    border-bottom: 2px solid rgb(43 45 51 / 0.1);
  }
  .pair {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pair .btn {
    flex: 1 1 140px;
  }
  .pair svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
  }
  .btn.danger {
    background: var(--bad);
    border-color: var(--ink);
    color: #ffffff;
  }
  .sure {
    margin: 0;
    font-weight: 600;
    font-size: 15px;
    line-height: 1.4;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--mute);
  }
  .error {
    margin: 0;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .name {
    font-size: 14px;
  }
  ewo-segmented {
    flex: none;
    width: min(300px, 62%);
  }
  @media (max-width: 480px) {
    .row {
      flex-direction: column;
      align-items: stretch;
      gap: 10px;
    }
    ewo-segmented {
      width: 100%;
    }
  }
</style>
