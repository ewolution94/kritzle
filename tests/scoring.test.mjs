import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drawerPoints, guessPoints } from '../server/scoring.mjs';

test('a guess scores 125 to 500 by the time left, plus a bonus for the first two', () => {
  assert.equal(guessPoints({ left: 80_000, total: 80_000, order: 5, difficulty: 'easy' }), 500);
  assert.equal(guessPoints({ left: 0, total: 80_000, order: 5, difficulty: 'easy' }), 125);
  assert.equal(guessPoints({ left: 40_000, total: 80_000, order: 5, difficulty: 'easy' }), 313);
  assert.equal(guessPoints({ left: 80_000, total: 80_000, order: 0, difficulty: 'easy' }), 600);
  assert.equal(guessPoints({ left: 80_000, total: 80_000, order: 1, difficulty: 'easy' }), 550);
});

test('harder words score more for everyone', () => {
  assert.equal(guessPoints({ left: 0, total: 80_000, order: 3, difficulty: 'medium' }), 156);
  assert.equal(guessPoints({ left: 80_000, total: 80_000, order: 3, difficulty: 'hard' }), 750);
});

test('the drawer gets the guessers average times the share who got it', () => {
  assert.equal(drawerPoints([], 4), 0);
  assert.equal(drawerPoints([400, 200], 4), 150);
  assert.equal(drawerPoints([400, 200, 300, 500], 4), 350);
  assert.equal(drawerPoints([400], 0), 0);
});
