// Kritzle QA: a host and a guest (two WebKit contexts, so two devices), two bots and the big screen at
// 1920 × 1080, walked through every screen and every mode: home (Settings), the join page, the lobby
// (more settings, the avatar maker), then Classic (the word choice, drawing with the mouse, a guess in
// the chat, the settings sheet in a turn, the right guess, the reveal), Team duel, Fälscher (strokes,
// the vote, the unmasking, the reveal) and Stille Post (a sentence, a drawing, the showcase), each to
// its end screen and back to the lobby. Each shot checks for anything past the right edge and console
// errors; AUDIT=1 also checks that every label sits in the middle of its box (tools/text-audit.mjs,
// development/plans/text-centering.md). Not part of CI: Playwright is borrowed from Folio's checkout
// next door (the workspace's `folio/node_modules`, WebKit already installed; PLAYWRIGHT=<path> from a
// worktree).
//
//   npm run build && node server/server.mjs --port 6111     (or the kritzle-prod preview)
//   node tools/qa.mjs [base] [outdir]          W=390 H=844 LANG_UI=de by default
//   AUDIT=1 node tools/qa.mjs …                  plus the text audits at every shot
import { mkdirSync } from 'node:fs';
import { digitAudit, textAudit } from './text-audit.mjs';

const { webkit } = await import(process.env.PLAYWRIGHT ?? '../../folio/node_modules/playwright/index.mjs');

const BASE = process.argv[2] ?? 'http://localhost:6111';
const OUT = process.argv[3] ?? '/tmp/kritzle-qa/';
const W = Number(process.env.W ?? 390), H = Number(process.env.H ?? 844);
const LANG = process.env.LANG_UI ?? 'de';
/** Text off its box's middle by this many px or more, at every shot (tools/text-audit.mjs). */
const AUDIT = process.env.AUDIT ? Number(process.env.AUDIT) : 0;
// Not centred labels, on purpose: the Fälscher's reveal card leaves its top to the tape hanging over
// its edge (the row is centred in what the tape leaves), and the chat's "the word was" line is a
// dashed rule above a line of text, not a box.
const AUDIT_SKIP = ['.reveal.box', 'li.word'];
const offCentre = new Map();
const oldDigits = new Map();
mkdirSync(OUT, { recursive: true });

const problems = [];
const say = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await webkit.launch();

async function person(name, viewport = { width: W, height: H }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  await context.addInitScript((lang) => {
    try {
      localStorage.setItem('ewo:lang', lang);
      localStorage.setItem('kritzle:sound', 'off');
    } catch {}
  }, LANG);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: console: ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${name}: page error: ${e.message}`));
  return { name, context, page, seat: null };
}

let n = 0;
async function shot(p, label) {
  await sleep(700); // entrances and the stream's next view
  const file = `${OUT}${String(++n).padStart(2, '0')}-${p.name}-${label}.png`;
  await p.page.screenshot({ path: file, fullPage: true });
  const wide = await p.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 0.5).slice(0, 4).map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].join('.'));
  });
  if (wide.length) problems.push(`${p.name} ${label}: past the right edge: ${wide.join(', ')}`);
  if (AUDIT) {
    for (const row of await p.page.evaluate(textAudit, { min: AUDIT, skip: AUDIT_SKIP })) {
      const key = `${row.where} | ${row.text}`;
      if (!offCentre.has(key)) offCentre.set(key, { ...row, at: `${p.name} ${label}` });
    }
    for (const row of await p.page.evaluate(digitAudit)) {
      const key = `${row.where} | ${row.text}`;
      if (!oldDigits.has(key)) oldDigits.set(key, { ...row, at: `${p.name} ${label}` });
    }
  }
  say(`  shot ${file.slice(OUT.length)}`);
}

// The API, as the page uses it: a move with the seat's token.
async function act(p, action, body = {}) {
  const res = await fetch(`${BASE}/api/rooms/${code}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kritzle-token': p.seat.token },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${p.name} ${action}: ${res.status} ${await res.text()}`);
}

/** One view of the room, as the server sends it to `p` (the first event of a fresh stream). */
async function view(p) {
  const abort = new AbortController();
  const res = await fetch(`${BASE}/api/rooms/${code}/events?p=${p.seat.player}`, { signal: abort.signal });
  const reader = res.body.getReader();
  let text = '';
  for (;;) {
    const { value } = await reader.read();
    text += new TextDecoder().decode(value);
    const m = text.match(/event: view\ndata: (.*)\n\n/);
    if (m) {
      abort.abort();
      return JSON.parse(m[1]);
    }
  }
}

/** Waits for a view that passes `test`; `step(v)` may move the game on meanwhile (a skip). */
async function until(p, test, what, step = null, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await view(p);
    if (test(v)) return v;
    if (step) await step(v).catch(() => {});
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const seatOf = (p) => p.page.evaluate((c) => JSON.parse(localStorage.getItem(`kritzle:seat:${c}`)), code);

/** A few strokes with the mouse, as a person draws: real pointer events on the canvas. */
async function scribble(p, selector = 'canvas') {
  const box = await p.page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${p.name}: no canvas to draw on`);
  const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
  for (const line of [
    [[0.2, 0.7], [0.5, 0.25], [0.8, 0.7]],
    [[0.3, 0.7], [0.7, 0.7]],
  ]) {
    await p.page.mouse.move(...at(...line[0]));
    await p.page.mouse.down();
    for (const point of line.slice(1)) await p.page.mouse.move(...at(...point), { steps: 8 });
    await p.page.mouse.up();
  }
  await sleep(300); // the batch goes out
}

async function openSettings(p, label) {
  await p.page.locator('ewo-settings-button').first().click();
  await shot(p, label);
  await p.page.keyboard.press('Escape');
  await sleep(400);
}

/** The host stops the game, everyone sees the end, and the host goes back to the lobby. */
async function finish(label) {
  await act(host, 'end').catch(() => {});
  await until(host, (v) => v.phase === 'final', 'the end screen');
  await shot(host, `${label}-final`);
  await shot(guest, `${label}-final`);
  await shot(screen, `${label}-final`);
  await act(host, 'rematch');
  await until(host, (v) => v.phase === 'lobby', 'the lobby again');
}

let code = '';
const host = await person('host');
const guest = await person('guest');
let screen = null;
try {
  // Home: the maker and Settings.
  say('home');
  await host.page.goto(BASE);
  await host.page.waitForSelector('ewo-emblem-maker');
  await shot(host, 'home');
  await openSettings(host, 'settings');

  // A room, through the page.
  await host.page.locator('input[autocomplete=nickname]').fill('Eva');
  await host.page.locator('button[type=submit].primary').click();
  await host.page.waitForURL(/\/[A-Z]{4}$/);
  code = new URL(host.page.url()).pathname.slice(1);
  host.seat = await seatOf(host);
  say(`room ${code}`);

  // The guest joins through the join page.
  await guest.page.goto(`${BASE}/${code}`);
  await guest.page.waitForSelector('form button[type=submit]');
  await shot(guest, 'join');
  await guest.page.locator('input[autocomplete=nickname]').fill('Ben');
  await guest.page.locator('form button[type=submit]').click();
  await guest.page.waitForFunction((c) => localStorage.getItem(`kritzle:seat:${c}`), code);
  guest.seat = await seatOf(guest);

  await act(host, 'bot', { add: true });
  await act(host, 'bot', { add: true });
  say('lobby');
  await shot(host, 'lobby');
  await shot(guest, 'lobby');
  await host.page.locator('button.more').click();
  await shot(host, 'lobby-more');
  await host.page.locator('button.more').click();
  await guest.page.locator('button.face').first().click();
  await shot(guest, 'avatar');
  await guest.page.keyboard.press('Escape');
  await sleep(400);

  // The big screen, from the start.
  screen = await person('screen', { width: 1920, height: 1080 });
  await screen.page.goto(`${BASE}/${code}/screen`);
  await shot(screen, 'lobby');
} catch (error) {
  problems.push(`stopped before the games: ${error.message}`);
}

/** One mode, from its settings to its end; a failure is a problem and the next mode still runs. */
async function mode(name, settings, play) {
  if (!host.seat || !screen) return;
  say(name);
  try {
    await act(host, 'settings', settings);
    await shot(host, `${name}-lobby`);
    if (name === 'duel') await shot(guest, `${name}-lobby`);
    await act(host, 'start');
    await play();
    await finish(name);
  } catch (error) {
    problems.push(`${name}: stopped: ${error.message}`);
    await act(host, 'end').catch(() => {});
    await act(host, 'rematch').catch(() => {});
    await sleep(500);
  }
}

// Classic: skip to the host's own turn, choose, draw; the guest guesses wrong, then right.
await mode('classic', { mode: 'classic', rounds: 2, seconds: 60, hints: 2 }, async () => {
  const skipOthers = async (v) => {
    if (v.turn && v.turn.drawer !== host.seat.player && ['choose', 'draw'].includes(v.turn.phase)) await act(host, 'skip');
  };
  await until(host, (v) => v.turn?.phase === 'choose' && v.turn.drawer === host.seat.player, "the host's turn", skipOthers);
  await shot(host, 'classic-choose');
  await shot(guest, 'classic-choose');
  await shot(screen, 'classic-choose');
  await host.page.locator('button.choice').first().click();
  const v = await until(host, (x) => x.turn?.phase === 'draw' && x.turn.word, 'the drawing');
  await scribble(host);
  await shot(host, 'classic-draw');
  await guest.page.locator('.chat input').fill(LANG === 'de' ? 'Haus' : 'house');
  await guest.page.locator('.chat input').press('Enter');
  await shot(guest, 'classic-guess');
  await openSettings(guest, 'classic-settings');
  await shot(screen, 'classic-draw');
  await act(guest, 'chat', { text: v.turn.word });
  await shot(guest, 'classic-got-it');
  await shot(host, 'classic-after-guess');
  await until(host, (x) => x.turn?.phase === 'reveal', 'the reveal', async (x) => x.turn?.phase === 'draw' && act(host, 'skip'));
  await shot(host, 'classic-reveal');
  await shot(guest, 'classic-reveal');
  await shot(screen, 'classic-reveal');
});

// Team duel: both teams draw the same word; the host's team's drawer draws when it's the host.
await mode('duel', { mode: 'duel', teams: 2, rounds: 2, seconds: 60 }, async () => {
  const v = await until(host, (x) => ['choose', 'draw'].includes(x.turn?.phase), 'the first duel turn');
  if (v.turn.phase === 'choose') {
    await shot(host, 'duel-choose');
    await shot(guest, 'duel-choose');
    const chooser = v.turn.drawer === host.seat.player ? host : v.turn.drawer === guest.seat.player ? guest : null;
    if (chooser) await chooser.page.locator('button.choice').first().click();
  }
  const d = await until(host, (x) => x.turn?.phase === 'draw', 'the duel drawing');
  const drawers = (d.turn.teams ?? []).map((x) => x.drawer);
  for (const p of [host, guest]) if (drawers.includes(p.seat.player)) await scribble(p);
  await shot(host, 'duel-draw');
  await shot(guest, 'duel-draw');
  await shot(screen, 'duel-draw');
  await act(host, 'skip');
  await until(host, (x) => x.turn?.phase === 'reveal', 'the duel reveal');
  await shot(host, 'duel-reveal');
  await shot(guest, 'duel-reveal');
  await shot(screen, 'duel-reveal');
});

// Fälscher: one lap of strokes (the people pass after drawing theirs), the vote, the unmasking.
await mode('forger', { mode: 'forger', rounds: 2, laps: 1, strokeSeconds: 10 }, async () => {
  let shotForge = false;
  await until(host, (x) => x.turn?.phase === 'vote', 'the vote', async (x) => {
    if (x.turn?.phase !== 'forge') return;
    if (!shotForge) {
      shotForge = true;
      await shot(host, 'forger-forge');
      await shot(guest, 'forger-forge');
      await shot(screen, 'forger-forge');
    }
    const p = [host, guest].find((q) => x.turn.stroke?.player === q.seat.player);
    if (p) {
      await scribble(p);
      await shot(p, 'forger-stroke');
      await act(p, 'pass');
    }
  });
  await shot(host, 'forger-vote');
  await shot(guest, 'forger-vote');
  await shot(screen, 'forger-vote');
  const v = await view(host);
  for (const p of [host, guest]) {
    const target = v.turn.order.find((id) => id !== p.seat.player);
    await act(p, 'vote', { player: target }).catch(() => {});
  }
  await shot(host, 'forger-voted');
  const after = await until(host, (x) => ['unmask', 'reveal'].includes(x.turn?.phase), 'the unmasking');
  if (after.turn.phase === 'unmask') {
    await shot(host, 'forger-unmask');
    await shot(guest, 'forger-unmask');
    await shot(screen, 'forger-unmask');
  }
  await until(host, (x) => x.turn?.phase === 'reveal', 'the forger reveal', null, 30_000);
  await shot(host, 'forger-reveal');
  await shot(guest, 'forger-reveal');
  await shot(screen, 'forger-reveal');
});

// Stille Post: a sentence each, a drawing each, then the showcase leafed through.
await mode('telephone', { mode: 'telephone', seconds: 60 }, async () => {
  await until(host, (x) => x.phase === 'tell', 'the first step');
  await shot(host, 'telephone-write');
  await shot(screen, 'telephone-write');
  await act(host, 'tell', { text: LANG === 'de' ? 'Ein Hund fährt Fahrrad' : 'A dog rides a bike' });
  await shot(host, 'telephone-sent');
  await act(guest, 'tell', { text: LANG === 'de' ? 'Die Katze kocht Suppe' : 'The cat cooks soup' });
  await until(host, (x) => x.phase === 'tell' && x.turn?.stepKind === 'draw', 'the drawing step', async (x) => x.phase === 'tell' && x.turn?.stepKind !== 'draw' && act(host, 'skip'));
  await sleep(800);
  await shot(host, 'telephone-draw');
  await scribble(host);
  await scribble(guest);
  await shot(guest, 'telephone-draw');
  await shot(screen, 'telephone-draw');
  await act(host, 'done');
  await shot(host, 'telephone-done');
  await until(host, (x) => x.phase === 'showcase', 'the showcase', async (x) => x.phase === 'tell' && act(host, 'skip'));
  await shot(host, 'telephone-showcase');
  await shot(guest, 'telephone-showcase');
  await shot(screen, 'telephone-showcase');
  for (let i = 0; i < 3; i++) await act(host, 'next').catch(() => {});
  await shot(host, 'telephone-showcase-later');
  await shot(screen, 'telephone-showcase-later');
});

await browser.close();

if (AUDIT) {
  say(`\ntext off its box's middle (≥ ${AUDIT} px; + low, − high; bias = the font's share):`);
  for (const r of offCentre.values()) say(`  ${String(r.off).padStart(5)} (bias ${r.bias})  ${r.font} h${r.height}  ${r.where}  "${r.text}"  [${r.at}]`);
  if (!offCentre.size) say('  none');
  say('old-style digits:');
  for (const r of oldDigits.values()) say(`  ${r.font}  ${r.where}  "${r.text}"  [${r.at}]`);
  if (!oldDigits.size) say('  none');
}
say(problems.length ? `\nproblems:\n  ${problems.join('\n  ')}` : '\nno problems');
process.exit(problems.length || offCentre.size || oldDigits.size ? 1 : 0);
