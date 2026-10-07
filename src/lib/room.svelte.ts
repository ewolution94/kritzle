// The live room: the server's view of it, the drawing and the chat, pushed over Server-Sent
// Events, and the moves you send (the drawer's ink in small batches).
//
// EventSource gives up for good after one error page (Cloudflare's 502 during a deploy), so it
// reconnects itself, with backoff, and right away when the tab comes back or the network returns
// (learnings/node-server.md).

import { api, type ChatLine, type Seat, type View } from './api';
import type { Op } from './ink';

const BACKOFF = [1000, 2000, 4000, 8000, 15000];
/** The drawer's ink goes up this often while the pen moves. */
const INK_EVERY = 50;
const CHAT_KEEP = 200;

type InkListener = (event: { kind: 'canvas' | 'ink'; turn: number; ops: Op[] }) => void;
type ReactListener = (event: { player: string; e: number }) => void;

/** One stream, either a player's (with a seat) or the big screen's (code only). */
export class Room {
  /** Replaced whole on every message, so it stays raw (no deep proxy to compare against). */
  view: View | null = $state.raw(null);
  chat: ChatLine[] = $state.raw([]);
  /** The stream is open. */
  live = $state(false);
  /** Server clock minus ours, for the countdown. */
  offset = $state(0);
  /** The current drawing as ops: what a canvas mounting now starts from. */
  drawing: { turn: number; ops: Op[] } = { turn: 0, ops: [] };

  #source: EventSource | null = null;
  #attempt = 0;
  #timer = 0;
  #closed = false;
  #ink = new Set<InkListener>();
  #react = new Set<ReactListener>();
  #pending: Op[] = [];
  #pendingTurn = 0;
  #sending = false;
  #sendTimer = 0;

  constructor(
    readonly code: string,
    readonly seat: Seat | null = null,
  ) {}

  connect() {
    this.#closed = false;
    addEventListener('online', this.#wake);
    document.addEventListener('visibilitychange', this.#wake);
    this.#open();
  }

  close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#source?.close();
    this.#source = null;
    this.live = false;
    removeEventListener('online', this.#wake);
    document.removeEventListener('visibilitychange', this.#wake);
  }

  /** A move; throws ApiError with the server's reason. */
  act(action: string, body?: unknown) {
    if (!this.seat) return Promise.reject(new Error('no seat'));
    return api.act(this.seat, action, body);
  }

  /** Milliseconds left until a server timestamp. */
  left(at: number, now = Date.now()) {
    return Math.max(0, at - (now + this.offset));
  }

  onInk(fn: InkListener) {
    this.#ink.add(fn);
    return () => this.#ink.delete(fn);
  }

  onReact(fn: ReactListener) {
    this.#react.add(fn);
    return () => this.#react.delete(fn);
  }

  /**
   * The drawer's own ops: kept as the drawing (they're already painted) and sent in batches, one
   * request at a time, with whatever piled up in between merged in.
   */
  ink(turn: number, ops: Op[]) {
    if (turn !== this.drawing.turn) this.drawing = { turn, ops: [] };
    this.drawing.ops.push(...ops.map((op) => [...op]));
    if (turn !== this.#pendingTurn) {
      this.#pending = [];
      this.#pendingTurn = turn;
    }
    for (const op of ops) {
      const last = this.#pending.at(-1);
      // More points of the stroke that's already waiting join its op.
      if (op[0] === 'p' && last?.[0] === 'p' && last[1] === op[1]) last.push(...op.slice(2));
      else this.#pending.push([...op]);
    }
    if (!this.#sending && !this.#sendTimer) this.#sendTimer = window.setTimeout(this.#flush, INK_EVERY);
  }

  #flush = async () => {
    this.#sendTimer = 0;
    if (!this.#pending.length || !this.seat) return;
    const turn = this.#pendingTurn;
    const ops = this.#pending.splice(0, 400);
    this.#sending = true;
    try {
      await api.act(this.seat, 'ink', { turn, ops });
    } catch {
      // The turn ended, or the network dropped: the server's drawing is what counts (it comes
      // back as the whole canvas on reconnect).
    } finally {
      this.#sending = false;
      if (this.#pending.length) this.#sendTimer = window.setTimeout(this.#flush, INK_EVERY);
    }
  };

  #open() {
    clearTimeout(this.#timer);
    this.#source?.close();
    const query = this.seat ? `?p=${encodeURIComponent(this.seat.player)}` : '';
    const source = new EventSource(`/api/rooms/${this.code}/events${query}`);
    this.#source = source;
    source.onopen = () => {
      this.#attempt = 0;
      this.live = true;
    };
    source.addEventListener('view', (event) => {
      const view = parse<View>(event);
      if (!view) return;
      if (typeof view.now === 'number') this.offset = view.now - Date.now();
      this.view = view;
      if (view.phase === 'gone') this.close();
    });
    source.addEventListener('canvas', (event) => {
      const body = parse<{ turn: number; ops: Op[] }>(event);
      if (!body) return;
      this.drawing = { turn: body.turn, ops: body.ops };
      for (const fn of this.#ink) fn({ kind: 'canvas', turn: body.turn, ops: body.ops });
    });
    source.addEventListener('ink', (event) => {
      const body = parse<{ turn: number; ops: Op[] }>(event);
      if (!body) return;
      if (body.turn !== this.drawing.turn) this.drawing = { turn: body.turn, ops: [] };
      this.drawing.ops.push(...body.ops);
      for (const fn of this.#ink) fn({ kind: 'ink', turn: body.turn, ops: body.ops });
    });
    source.addEventListener('chat', (event) => {
      const body = parse<{ lines: ChatLine[]; backlog?: boolean }>(event);
      if (!body) return;
      const known = new Set(this.chat.map((l) => l.id));
      const fresh = body.lines.filter((l) => !known.has(l.id));
      if (fresh.length) this.chat = [...this.chat, ...fresh].sort((a, b) => a.id - b.id).slice(-CHAT_KEEP);
    });
    source.addEventListener('react', (event) => {
      const body = parse<{ player: string; e: number }>(event);
      if (body) for (const fn of this.#react) fn(body);
    });
    source.onerror = () => {
      source.close();
      if (this.#source !== source) return;
      this.#source = null;
      this.live = false;
      if (this.#closed) return;
      const wait = BACKOFF[Math.min(this.#attempt++, BACKOFF.length - 1)];
      this.#timer = window.setTimeout(() => this.#open(), wait);
    };
  }

  #wake = () => {
    if (this.#closed || this.live || document.visibilityState === 'hidden') return;
    this.#attempt = 0;
    this.#open();
  };
}

function parse<T>(event: Event): T | null {
  try {
    return JSON.parse((event as MessageEvent).data) as T;
  } catch {
    return null;
  }
}
