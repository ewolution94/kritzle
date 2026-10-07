import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PARTS, cleanAvatar } from '../server/avatar.mjs';
import { cleanEmblem, emblemRanges, isEmblem } from '../vendor/ewo/elements/emblem-core.js';

// The page draws faces with Folio's doodle emblem (vendor/ewo); the server checks avatars on its own
// (the runtime image carries no vendor files). These keep the two in step after a vendor update.

test("the server's ranges are the doodle emblem's", () => {
  assert.deepEqual([...AVATAR_PARTS], emblemRanges('doodle'));
});

test('the server keeps what the emblem keeps, and replaces what it replaces', () => {
  const cases = [[0, 0, 0, 0, 0], [9, 9, 7, 9, 11], [10, 0, 0, 0, 0], [0, 0, 8, 0, 0], [1, 2, 3, 4], [1.5, 0, 0, 0, 0], '1,2,3,4,5', null];
  for (const raw of cases) {
    const ours = cleanAvatar(raw);
    assert.ok(isEmblem('doodle', ours), `${JSON.stringify(raw)} → ${ours}`);
    if (isEmblem('doodle', raw)) assert.deepEqual(ours, cleanEmblem('doodle', raw));
    else assert.notEqual(ours, raw);
  }
});
