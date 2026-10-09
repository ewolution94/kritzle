// Waiting for the server, at the control that asked (Folio's track(), plans/waiting-states.md): the
// tapped button stays pressed and locked until the answer, shows the scribble after 150 ms, says
// what it's doing after 1.2 s, "Dauert länger …" after 6 s, and offers "Nochmal" at 12 s.

import { track } from '../../vendor/ewo/elements/waiting.js';
import { ApiError } from './api';
import { t, type Key } from './i18n.svelte';
import type { Room } from './room.svelte';

/** What a move says after 1.2 s; moves without words show only the scribble. */
function label(action: string, body: unknown): string | undefined {
  const add = (body as { add?: boolean } | undefined)?.add;
  const key: Key | null =
    action === 'bot'
      ? add
        ? 'wait_bot_add'
        : 'wait_bot_remove'
      : (({ start: 'wait_start', team: 'wait_team', shuffle: 'wait_shuffle', rematch: 'wait_rematch', choose: 'wait_choose', vote: 'wait_vote', unmask: 'wait_unmask', tell: 'wait_tell', done: 'wait_tell', leave: 'wait_leave' }) as Record<string, Key>)[action] ?? null;
  return key ? t(key) : undefined;
}

/** The control behind an event: the clicked button, or a form's submit button. */
export function controlOf(from: Event | Element | null | undefined): Element | null {
  if (!from) return null;
  if (from instanceof Element) return from;
  if (from instanceof SubmitEvent && from.submitter) return from.submitter;
  return from.currentTarget instanceof Element ? from.currentTarget : null;
}

/**
 * Any wait at a control: `run` gets the signal that track() aborts at 12 s. A timeout comes back as
 * ApiError('timeout'), so the components' error words cover it.
 */
export async function waitAt<T>(from: Event | Element | null | undefined, run: (signal: AbortSignal) => Promise<T>, words?: string): Promise<T | undefined> {
  try {
    return await track(controlOf(from), run, { label: words });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    throw error instanceof ApiError ? error : new ApiError(code === 'timeout' ? 'timeout' : 'other');
  }
}

/** A move in the room, waited for at the control that made it. */
export function actAt(room: Room, action: string, body: unknown, from?: Event | Element | null) {
  return waitAt(from, (signal) => room.act(action, body, signal), label(action, body));
}

/** A fresh key for one "New game" or join, the same for every retry of it (server/game.mjs). */
export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
