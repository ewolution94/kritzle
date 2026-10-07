<!-- A finished drawing as a picture (Stille Post's prompts and chains). -->
<script lang="ts">
  import { render, toActions, type Op } from '../lib/ink';

  let { ops, label = '' }: { ops: Op[]; label?: string } = $props();

  const src = $derived(render(toActions(ops), 800).toDataURL('image/png'));
</script>

<img class="picture" {src} alt={label} width="800" height="600" />

<style>
  .picture {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 3px;
    background: #ffffff;
    box-shadow: 0 0 0 2px var(--ink), 3px 4px 0 2px rgb(43 45 51 / 0.12);
  }
</style>
