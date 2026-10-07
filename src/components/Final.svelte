<!--
  The end: the podium (the winner wears the crown), the awards, and the gallery. Every drawing of
  the game replays as a timelapse and downloads as a PNG; "All as one image" puts the whole game
  on one sheet. Drawings live only in the server's memory: these downloads are the only copies.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError, type View } from '../lib/api';
  import { errorText, num, t, type Key } from '../lib/i18n.svelte';
  import { duration, H, paintAll, render, toActions, W, type Action } from '../lib/ink';
  import type { Room } from '../lib/room.svelte';
  import Avatar from './Avatar.svelte';

  let { room, view, onleave }: { room: Room; view: View; onleave: () => void } = $props();

  type Drawing = { n: number; drawer: string; word: string; actions: Action[]; thumb: string; likes: number; kind: string; team: number | null };
  let drawings: Drawing[] = $state([]);
  let loading = $state(true);
  let open: Drawing | null = $state(null);
  /** The drawing the sheet shows: kept until its exit animation is over (its close event). */
  let shownDrawing: Drawing | null = $state(null);
  $effect(() => {
    if (open) shownDrawing = open;
  });
  let error = $state('');
  let replayCanvas: HTMLCanvasElement | undefined = $state();
  let frame = 0;

  const ranked = $derived([...view.players].sort((a, b) => b.score - a.score));
  const podium = $derived([ranked[1], ranked[0], ranked[2]].filter(Boolean));
  const tie = $derived(ranked.length > 1 && ranked[0].score === ranked[1].score);
  const names = $derived(new Map(view.players.map((p) => [p.id, p.name])));
  const isHost = $derived(view.me === view.host);
  const awards = $derived(view.final?.awards ?? {});
  const hostName = $derived(names.get(view.host) ?? '');
  const teamScores = $derived(view.teams ? view.teams.map((score, team) => ({ team, score })).sort((a, b) => b.score - a.score) : null);
  const teamTie = $derived(Boolean(teamScores && teamScores.length > 1 && teamScores[0].score === teamScores[1].score));
  const teamName = (team: number) => t(`team_${team}` as Key);

  onMount(() => {
    api.gallery(view.code).then(
      ({ drawings: list }) => {
        const info = new Map((view.final?.drawings ?? []).map((d) => [d.n, d]));
        drawings = list.map((d) => {
          const actions = toActions(d.ops);
          return { ...d, actions, thumb: render(actions, 360).toDataURL('image/png'), likes: info.get(d.n)?.likes ?? 0 };
        });
        loading = false;
      },
      () => (loading = false),
    );
    return () => cancelAnimationFrame(frame);
  });

  /** The timelapse: the whole drawing in its own rhythm, squeezed into at most eight seconds. */
  function replay() {
    cancelAnimationFrame(frame);
    const d = shownDrawing;
    const canvas = replayCanvas;
    if (!d || !canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round((canvas.clientWidth * dpr * H) / W);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    const total = duration(d.actions);
    const speed = Math.max(1, total / 8000);
    const start = performance.now();
    const step = () => {
      const until = (performance.now() - start) * speed;
      paintAll(ctx, d.actions, until);
      if (until < total) frame = requestAnimationFrame(step);
    };
    step();
  }

  $effect(() => {
    if (open && shownDrawing && replayCanvas) replay();
  });

  async function save(canvas: HTMLCanvasElement, name: string) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const fileName = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'kritzle';

  async function caption(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number) {
    await document.fonts.load(`${px}px "Caveat Brush"`).catch(() => {});
    ctx.font = `${px}px "Caveat Brush", "Comic Sans MS", cursive`;
    ctx.fillStyle = '#2b2d33';
    ctx.fillText(text, x, y);
  }

  /** One drawing with its word and drawer underneath. */
  async function downloadOne(d: Drawing) {
    const art = render(d.actions, 1600);
    const out = document.createElement('canvas');
    out.width = 1600;
    out.height = 1320;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fdfdfb';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(art, 0, 0);
    await caption(ctx, `${d.word} · ${t('by', { name: names.get(d.drawer) ?? '' })}`, 40, 1282, 72);
    ctx.font = '600 26px Geist, sans-serif';
    ctx.fillStyle = '#62656d';
    ctx.textAlign = 'right';
    ctx.fillText('kritzle.ewolution.cloud', 1560, 1278);
    await save(out, `kritzle-${fileName(d.word)}.png`);
  }

  /** The whole game on one sheet of graph paper. */
  async function downloadAll() {
    const cols = drawings.length > 4 ? 3 : 2;
    const cell = 480;
    const rows = Math.ceil(drawings.length / cols);
    const pad = 40;
    const out = document.createElement('canvas');
    out.width = cols * cell + (cols + 1) * pad;
    out.height = 120 + rows * (cell * 0.75 + 70) + pad;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#fdfdfb';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.strokeStyle = '#dde8f6';
    ctx.lineWidth = 1;
    for (let x = 0; x < out.width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, out.height);
      ctx.stroke();
    }
    for (let y = 0; y < out.height; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(out.width, y + 0.5);
      ctx.stroke();
    }
    await caption(ctx, `Kritzle · ${view.code} · ${new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}`, pad, 80, 56);
    drawings.forEach((d, i) => {
      const x = pad + (i % cols) * (cell + pad);
      const y = 120 + Math.floor(i / cols) * (cell * 0.75 + 70);
      ctx.drawImage(render(d.actions, cell), x, y);
      ctx.strokeStyle = '#2b2d33';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, cell, cell * 0.75);
    });
    for (const [i, d] of drawings.entries()) {
      const x = pad + (i % cols) * (cell + pad);
      const y = 120 + Math.floor(i / cols) * (cell * 0.75 + 70);
      await caption(ctx, `${d.word} · ${names.get(d.drawer) ?? ''}`, x, y + cell * 0.75 + 44, 36);
    }
    await save(out, `kritzle-${view.code.toLowerCase()}.png`);
  }

  async function again() {
    error = '';
    try {
      await room.act('rematch');
    } catch (e) {
      error = errorText(e instanceof ApiError ? e.code : 'other');
    }
  }
</script>

<div class="final">
  <h1 class="display title">
    <span class="hl">
      {#if teamScores}{teamTie ? t('tie') : t('teamWins', { name: teamName(teamScores[0].team) })}{:else}{tie ? t('tie') : t('winner', { name: ranked[0]?.name ?? '' })}{/if}
    </span>
  </h1>

  {#if teamScores}
    <ol class="teams">
      {#each teamScores as x, i (x.team)}
        <li class:first={i === 0}><span class="team-tag t{x.team}">{t('teamName', { name: teamName(x.team) })}</span><span class="score">{num(x.score)}</span></li>
      {/each}
    </ol>
  {/if}

  <ol class="podium">
    {#each podium as p (p.id)}
      {@const place = ranked.indexOf(p) + 1}
      <li class="place p{place}">
        <Avatar avatar={p.avatar} size={place === 1 ? 84 : 64} crown={place === 1} mood={place === 1 ? 'happy' : ''} />
        <span class="name">{p.name}</span>
        <span class="score">{num(p.score)}</span>
        <span class="block box display">{place}</span>
      </li>
    {/each}
  </ol>

  {#if ranked.length > 3}
    <ol class="rest" start="4">
      {#each ranked.slice(3) as p (p.id)}
        <li><span class="rank">{ranked.indexOf(p) + 1}.</span><Avatar avatar={p.avatar} size={30} /><span class="name">{p.name}</span><span class="score">{num(p.score)}</span></li>
      {/each}
    </ol>
  {/if}

  {#if Object.keys(awards).length}
    <ul class="awards">
      {#if awards.liked}<li class="box"><span class="label">{t('award_liked')}</span><span><b>{awards.liked.word}</b>{` · ${names.get(awards.liked.drawer) ?? ''} ♥ ${awards.liked.likes}`}</span></li>{/if}
      {#if awards.fastest}<li class="box alt"><span class="label">{t('award_fastest')}</span><span><b>{t('awardFastest', { name: names.get(awards.fastest.player) ?? '', s: num(Math.round(awards.fastest.ms / 100) / 10) })}</b>{` · ${awards.fastest.word}`}</span></li>{/if}
      {#if awards.close}<li class="box"><span class="label">{t('award_close')}</span><span><b>{t('awardClose', { name: names.get(awards.close.player) ?? '', n: awards.close.count })}</b></span></li>{/if}
      {#if awards.forger}<li class="box"><span class="label">{t('award_forger')}</span><span><b>{t('awardForger', { name: names.get(awards.forger.player) ?? '', n: awards.forger.count })}</b></span></li>{/if}
      {#if awards.unsolved}<li class="box alt"><span class="label">{t('award_unsolved')}</span><span><b>{awards.unsolved.word}</b>{` · ${names.get(awards.unsolved.drawer) ?? ''}`}</span></li>{/if}
    </ul>
  {/if}

  <div class="actions">
    {#if isHost}
      <button class="btn primary" type="button" onclick={again}>{t('playAgain')}</button>
    {:else}
      <p class="wait display">{t('waitAgain', { name: hostName })}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  </div>

  <section class="gallery">
    <h2><span class="display">{t('gallery')}</span><span class="label">{t('galleryCount', { n: drawings.length })}</span></h2>
    {#if loading}
      <p class="label">{t('loadingGallery')}</p>
    {:else}
      <ul>
        {#each drawings as d (d.n)}
          <li>
            <button class="thumb" type="button" onclick={() => (open = d)} aria-label="{t('replay')}: {d.word}">
              <img src={d.thumb} alt="" width="360" height="270" />
              <span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z" /></svg></span>
            </button>
            <span class="meta">
              <b>{d.word}</b>
              <span>
                {#if d.team !== null}<i class="dot t{d.team}" aria-hidden="true"></i>{/if}{(d.kind === 'forger' ? t('forgerTag', { name: names.get(d.drawer) ?? '' }) : (names.get(d.drawer) ?? '')) + (d.likes ? ` · ♥ ${d.likes}` : '')}
              </span>
            </span>
          </li>
        {/each}
      </ul>
      {#if drawings.length}
        <button class="btn" type="button" onclick={downloadAll}>{t('downloadAll')}</button>
      {/if}
    {/if}
  </section>

  <button class="btn quiet leave" type="button" onclick={onleave}>{t('leaveGame')}</button>
</div>

<ewo-sheet
  open={Boolean(open)}
  wide
  label={shownDrawing?.word ?? ''}
  oncancel={() => (open = null)}
  onclose={() => {
    open = null;
    shownDrawing = null;
  }}
>
  <span slot="heading" class="display sheet-title">{shownDrawing?.word ?? ''}</span>
  {#if shownDrawing}
    <div class="replay">
      <canvas bind:this={replayCanvas} class="paper"></canvas>
      <p class="by">{t('by', { name: names.get(shownDrawing.drawer) ?? '' })}</p>
      <div class="row">
        <button class="btn small" type="button" onclick={replay}>{t('replay')}</button>
        <button class="btn small" type="button" onclick={() => shownDrawing && downloadOne(shownDrawing)}>{t('downloadPng')}</button>
      </div>
    </div>
  {/if}
</ewo-sheet>

<style>
  .final {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
    max-width: 900px;
    margin: 8px auto 0;
  }
  .title {
    margin: 0;
    font-size: clamp(38px, 9vw, 64px);
    line-height: 1.05;
    text-align: center;
    text-wrap: balance;
  }
  .teams {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .teams li {
    display: flex;
    align-items: center;
    gap: 8px;
    font: 700 15px/1.2 var(--ewo-sans);
  }
  .teams li.first {
    font-size: 18px;
  }
  .teams .score {
    font-family: var(--ewo-mono);
  }
  .team-tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 6px;
    color: #ffffff;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 5px;
    border-radius: 50%;
  }
  .t0 { background: #c9341f; }
  .t1 { background: #2d5bd8; }
  .t2 { background: #8a6d00; }
  .t3 { background: #1f7a45; }
  .podium {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 150px));
    align-items: end;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .place {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .place .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 15px/1.2 var(--ewo-sans);
  }
  .place .score {
    font: 600 13px/1 var(--ewo-mono);
    color: var(--ink-2);
  }
  .block {
    display: grid;
    place-items: center;
    width: 100%;
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    font-size: 34px;
  }
  .p1 .block {
    height: 96px;
    background: var(--hi);
  }
  .p2 .block {
    height: 68px;
  }
  .p3 .block {
    height: 48px;
  }
  .rest {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(100%, 360px);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .rest li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .rest .rank {
    width: 24px;
    color: var(--mute);
  }
  .rest .name {
    flex: 1;
    font-weight: 600;
  }
  .rest .score {
    font: 600 13px/1 var(--ewo-mono);
  }
  .awards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 10px;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .awards li {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .wait {
    margin: 0;
    font-size: 24px;
  }
  .gallery {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }
  .gallery h2 {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 0;
  }
  .gallery h2 .display {
    font-size: 34px;
  }
  .gallery ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 18px 14px;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .gallery li {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .gallery li:nth-child(odd) .thumb {
    rotate: -1deg;
  }
  .gallery li:nth-child(even) .thumb {
    rotate: 1.2deg;
  }
  .thumb {
    position: relative;
    display: block;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: #ffffff;
    box-shadow: 0 0 0 2px var(--ink), 3px 4px 0 2px rgb(43 45 51 / 0.12);
    -webkit-tap-highlight-color: transparent;
  }
  .thumb img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 3px;
  }
  .play {
    position: absolute;
    left: 6px;
    top: 6px;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: rgb(43 45 51 / 0.8);
  }
  .play svg {
    width: 12px;
    height: 12px;
    fill: #ffffff;
  }
  .meta {
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .meta span {
    color: var(--mute);
  }
  .leave {
    margin-top: 8px;
  }
  .sheet-title {
    font-size: 28px;
  }
  .replay {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 8px;
  }
  .paper {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: 3px;
    background: #ffffff;
    box-shadow: 0 0 0 2px var(--ink);
  }
  .by {
    margin: 0;
    color: var(--mute);
  }
  .row {
    display: flex;
    gap: 8px;
  }
</style>
