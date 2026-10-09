// The server's shapes (server/game.mjs → view) and the calls that change them.

import type { Avatar } from './avatar';
import type { Op } from './ink';

export type Phase = 'lobby' | 'choose' | 'draw' | 'forge' | 'vote' | 'unmask' | 'tell' | 'showcase' | 'reveal' | 'final' | 'gone';
export type Mode = 'classic' | 'blitz' | 'forger' | 'duel' | 'telephone';
export type Spice = 'blind' | 'oneline' | 'ink' | 'three' | 'mirror' | 'shaky';
export type SpiceChoice = 'off' | 'random' | Spice;
export type WordMode = 'normal' | 'hidden' | 'combo';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultyChoice = 'mixed' | Difficulty;
export type Pack = 'everyday' | 'animals' | 'food' | 'places' | 'jobs' | 'office' | 'sports' | 'nature' | 'things' | 'travel' | 'hobbies' | 'fantasy';
export type WordLang = 'de' | 'en';

export interface Settings {
  mode: Mode;
  rounds: number;
  seconds: number;
  /** Words the drawer chooses from. */
  words: number;
  hints: number;
  wordMode: WordMode;
  lang: WordLang;
  packs: Pack[];
  difficulty: DifficultyChoice;
  /** The host's own words (empty for everyone else, who only get the count). */
  custom: string;
  customCount: number;
  onlyCustom: boolean;
  nearMiss: boolean;
  /** Würze: off, random each turn, or one for every turn. */
  spice: SpiceChoice;
  /** Team duel: how many teams. */
  teams: number;
  /** Fälscher: laps round the table, and seconds per stroke. */
  laps: number;
  strokeSeconds: number;
}

export interface Player {
  id: string;
  name: string;
  avatar: Avatar;
  score: number;
  online: boolean;
  bot: boolean;
  /** Team duel: their team's index; null otherwise. */
  team: number | null;
  /** Has the word this turn (Fälscher: has voted). */
  guessed: boolean;
  /** This turn's points, once it's over. */
  points: number | null;
}

export interface TeamTurn {
  team: number;
  drawer: string;
  done: boolean;
  order: number | null;
  at: number | null;
  points: number | null;
}

export interface Turn {
  kind: 'classic' | 'duel' | 'forger' | 'telephone';
  n: number;
  round: number;
  /** classic: the drawer; null in a duel (each team has one) and in Fälscher. */
  drawer: string | null;
  phase: 'choose' | 'draw' | 'forge' | 'vote' | 'unmask' | 'tell' | 'showcase' | 'reveal';
  /** choose */
  endsAt: number;
  choices?: { word: string; difficulty: Difficulty }[] | null;
  /** draw, reveal */
  startsAt?: number;
  difficulty?: Difficulty;
  /** For the drawer and whoever has guessed, and for everyone at the end. */
  word?: string | null;
  /** The blanks, with hints filled in; null for hidden words before the first hint. */
  pattern?: string | null;
  hints?: number;
  hintsTotal?: number;
  guessed?: number;
  /** Your like: 1, -1 or 0. */
  like?: number;
  likes?: number;
  dislikes?: number;
  ended?: 'time' | 'all' | 'skip' | 'drawer-gone' | 'escaped' | 'caught' | 'guessed' | 'forger-gone' | null;
  revealEndsAt?: number | null;
  spice?: Spice | null;
  /** Würze "three colours": the three palette indices. */
  palette?: number[] | null;
  /** Team duel */
  myTeam?: number | null;
  teams?: TeamTurn[] | null;
  /** Fälscher */
  category?: string;
  forgerMe?: boolean;
  forger?: string | null;
  order?: string[];
  laps?: number;
  step?: number;
  colors?: Record<string, number>;
  stroke?: { player: string; endsAt: number; started: boolean } | null;
  voted?: string[] | null;
  myVote?: string | null;
  tally?: Record<string, number> | null;
  caught?: boolean | null;
  forgerGuess?: string | null;
  forgerRight?: boolean | null;
  /** Stille Post */
  steps?: number;
  stepKind?: 'write' | 'draw' | 'describe';
  done?: string[];
  myDone?: boolean;
  myText?: string | null;
  prompt?: string | null;
  promptDrawing?: boolean;
  suggestion?: string | null;
  show?: { chain: number; entry: number; owner: string; chains: number; length: number } | null;
}

export interface ChainEntry {
  player: string;
  kind: 'text' | 'drawing';
  text?: string;
  ops?: Op[];
}

export interface Awards {
  liked?: { n: number; drawer: string; word: string; likes: number };
  fastest?: { player: string; ms: number; word: string };
  close?: { player: string; count: number };
  unsolved?: { n: number; drawer: string; word: string };
  forger?: { player: string; count: number };
}

export interface DrawingInfo {
  n: number;
  round: number;
  drawer: string;
  word: string;
  difficulty: Difficulty;
  likes: number;
  dislikes: number;
  guessed: number;
  possible: number;
  kind: 'classic' | 'duel' | 'forger' | 'telephone';
  team: number | null;
}

export interface View {
  code: string;
  phase: Phase;
  version: number;
  host: string;
  me: string | null;
  settings: Settings;
  notice: string | null;
  players: Player[];
  game: { mode: Mode; rounds: number; round: number; teams: number } | null;
  /** Team duel: each team's total. */
  teams: number[] | null;
  turn: Turn | null;
  /** `ended`: the host ended it early (who), else null. */
  final: { ended: { by: string } | null; awards: Awards | null; drawings: DrawingInfo[] } | null;
  reactions: string[];
  now: number;
}

export interface ChatLine {
  id: number;
  kind: 'msg' | 'guessed' | 'team' | 'close' | 'half' | 'join' | 'leave' | 'word' | 'skip' | 'host';
  player: string;
  text: string;
  /** Only some saw it: those who know the word, or only you. */
  private: boolean;
  at: number;
}

export interface Seat {
  code: string;
  player: string;
  token: string;
}

export interface Config {
  modes: Mode[];
  rounds: number[];
  seconds: number[];
  words: number[];
  hints: number[];
  wordModes: WordMode[];
  difficulties: DifficultyChoice[];
  langs: WordLang[];
  packs: Pack[];
  counts: Record<WordLang, number>;
  custom: { words: number; length: number; text: number; min: number };
  reactions: string[];
  spices: SpiceChoice[];
  teams: number[];
  laps: number[];
  strokeSeconds: number[];
}

/**
 * A refusal from the server ("no-room", "spoiler" …), a network failure ("offline"), the server or
 * Cloudflare in trouble ("busy": a 5xx without the game's own answer) or no answer in time
 * ("timeout", Folio's track() gave up). The last three are worth "Try again" (waiting.ts).
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { ...init, cache: 'no-store' });
  } catch {
    // Given up on (the signal from track()), or the network: Safari says "Load failed", Chrome
    // "Failed to fetch", so classify by type (learnings/ios-and-webkit.md).
    throw new ApiError(init.signal?.aborted ? 'timeout' : 'offline');
  }
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    // A 5xx without the game's own error is the NAS or Cloudflare (a 502, a 1033 page).
    throw new ApiError(body?.error ?? (response.status >= 500 ? 'busy' : `http-${response.status}`), response.status);
  }
  return body as T;
}

const withToken = (token: string): RequestInit => ({ headers: { 'x-kritzle-token': token } });

const post = (body: unknown, token?: string, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { 'x-kritzle-token': token } : {}) },
  body: JSON.stringify(body ?? {}),
  signal,
});

export const api = {
  config: () => request<Config>('/api/config'),
  /** `key`: the same for every try of one "New game", so a retry after a timeout gets the same room. */
  create: (name: string, avatar: Avatar, key?: string, signal?: AbortSignal) => request<Seat>('/api/rooms', post({ name, avatar, key }, undefined, signal)),
  info: (code: string) => request<{ code: string; phase: Phase; players: number; full: boolean }>(`/api/rooms/${code}`),
  /** `key`: as for create, so a retried join doesn't seat you twice. */
  join: (code: string, name: string, avatar: Avatar | null, token?: string, key?: string, signal?: AbortSignal) =>
    request<Seat>(`/api/rooms/${code}/join`, post({ name, avatar, token, key }, undefined, signal)),
  act: (seat: Seat, action: string, body?: unknown, signal?: AbortSignal) => request<void>(`/api/rooms/${seat.code}/${action}`, post(body, seat.token, signal)),
  prompt: (seat: Seat) => request<{ turn: number; step: number; ops: Op[] }>(`/api/rooms/${seat.code}/prompt`, withToken(seat.token)),
  chains: (code: string) => request<{ chains: { owner: string; entries: ChainEntry[] }[] }>(`/api/rooms/${code}/chains`),
  gallery: (code: string) =>
    request<{ drawings: { n: number; drawer: string; word: string; kind: 'classic' | 'duel' | 'forger' | 'telephone'; team: number | null; ops: Op[] }[] }>(`/api/rooms/${code}/gallery`),
};

/** Room codes: four consonants (server/game.mjs → CODE). */
export const CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
