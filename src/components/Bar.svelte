<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../lib/i18n.svelte';
  import Logo from './Logo.svelte';
  import Settings from './Settings.svelte';

  let { code }: { code: string | null } = $props();

  let scrolled = $state(false);
  let settingsOpen = $state(false);
  let button: HTMLElement | undefined = $state();

  function closeSettings() {
    settingsOpen = false;
    // Focus goes back where it came from.
    button?.focus();
  }
  onMount(() => {
    const check = () => (scrolled = scrollY > 8);
    check();
    addEventListener('scroll', check, { passive: true });
    return () => removeEventListener('scroll', check);
  });
</script>

<header class="bar" class:scrolled>
  <a class="home" href="/" aria-label="Kritzle"><Logo /></a>
  <div class="end">
    {#if code}
      <span class="tape code" aria-label="{t('code')} {code}">{code}</span>
    {/if}
    <!-- A real <button> sits inside the element: Enter and Space reach this handler as a click. -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <ewo-settings-button bind:this={button} onclick={() => (settingsOpen = true)}></ewo-settings-button>
  </div>
</header>

<Settings open={settingsOpen} onclose={closeSettings} />

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: var(--bar-h);
    padding: 0 var(--gutter);
    background: color-mix(in oklab, var(--paper) 94%, transparent);
    border-bottom: 2px solid transparent;
  }
  .bar.scrolled {
    border-bottom-color: rgb(43 45 51 / 0.12);
  }
  .home {
    text-decoration: none;
  }
  .end {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .code {
    transform: rotate(-3deg);
  }
</style>
