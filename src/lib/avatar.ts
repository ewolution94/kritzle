// An avatar is five small numbers: head, eyes, extra, mouth, colour (the maker's arrows, top to
// bottom). Folio's doodle emblem draws the face from them (<ewo-emblem theme="doodle">, vendor/ewo;
// development/plans/emblems.md), its wobble seeded from the numbers, so every screen draws the same
// face. The server checks the same ranges (server/avatar.mjs; tests/avatar.test.mjs keeps them in step).

import { isEmblem, randomEmblem } from '../../vendor/ewo/elements/emblem-core.js';

export type Avatar = [number, number, number, number, number];
/** A face's mood in the game: a right guess makes it happy for a moment. */
export type Mood = '' | 'happy';

export const isAvatar = (value: unknown): value is Avatar => isEmblem('doodle', value);

export const randomAvatar = () => randomEmblem('doodle') as Avatar;
