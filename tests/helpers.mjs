// Shared by the game tests: a fake clock, a seeded random, and rooms set up the way pages use them.

import { createGames } from '../server/game.mjs';

/** A clock that only moves when the test says so. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  let timers = [];
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const handle = { at: t + ms, fn };
      timers.push(handle);
      return handle;
    },
    clearTimeout(handle) {
      timers = timers.filter((h) => h !== handle);
    },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((h) => h.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((h) => h !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
  };
}

/** mulberry32's 32-bit words: the same sequence for the same seed. */
export function words(seed = 1) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * An integer in 0..n-1 from 32-bit words, exactly uniform: a word at or past the last full multiple
 * of n is drawn again, the way node:crypto's randomInt does it (learnings/randomness.md in the
 * workspace). Scaling or taking the word modulo n would favour the low numbers.
 * @param {number} n  @param {() => number} word
 */
export function fairInt(n, word) {
  if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError('fairInt needs an integer 1 ≤ n ≤ 2^32');
  const limit = Math.floor(0x100000000 / n) * n;
  let w = word() >>> 0;
  while (w >= limit) w = word() >>> 0;
  return w % n;
}

/** A repeatable randomInt(n) → 0..n-1, for the rooms in place of node:crypto's. */
export function seededInt(seed = 1) {
  const word = words(seed);
  return (n) => fairInt(n, word);
}

export function setup() {
  const clock = fakeClock();
  const games = createGames({ clock, randomInt: seededInt(7) });
  return { clock, games };
}

/**
 * A page on the room's stream, keeping what it was sent: the latest view, the chat lines, the
 * ink and the canvases.
 */
export function watch(games, code, playerId = null) {
  const page = { view: null, chat: [], ink: [], canvas: [], reacts: [] };
  page.close = games.subscribe(code, playerId, (event, data) => {
    const body = JSON.parse(data);
    if (event === 'view') page.view = body;
    else if (event === 'chat') page.chat.push(...body.lines);
    else if (event === 'ink') page.ink.push(body);
    else if (event === 'canvas') page.canvas.push(body);
    else if (event === 'react') page.reacts.push(body);
  });
  return page;
}

/** A host and `others` more players, all on the stream. */
export function room(games, others = 2) {
  const host = games.create({ name: 'Anna', avatar: [1, 0, 0, 0, 0] });
  const seats = [host];
  for (let i = 0; i < others; i++) seats.push(games.join(host.code, { name: ['Ben', 'Lea', 'Mia', 'Jonas', 'Emre'][i] }));
  const pages = seats.map((s) => watch(games, host.code, s.player));
  return { code: host.code, seats, pages, host };
}

/** The seat whose turn it is to draw (from anyone's view). */
export function drawerSeat(seats, pages) {
  const id = pages[0].view.turn.drawer;
  return seats.find((s) => s.player === id);
}

/** The word, as the drawer's page shows it. */
export function wordOf(seats, pages) {
  const i = seats.findIndex((s) => s.player === pages[0].view.turn.drawer);
  return pages[i].view.turn.word;
}
