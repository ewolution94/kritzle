import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps, newDrawing, toOps, FILL_H, FILL_W, INK_LIMITS } from '../server/ink.mjs';

test('strokes grow point by point and come back whole', () => {
  const d = newDrawing();
  const a = applyOps(d, [['s', 1, 3, 2, 10, 20, 0], ['p', 1, 30, 40, 16, 50, 60, 32]]);
  assert.deepEqual(a, [['s', 1, 3, 2, 10, 20, 0], ['p', 1, 30, 40, 16, 50, 60, 32]]);
  assert.deepEqual(toOps(d), [['s', 1, 3, 2, 10, 20, 0], ['p', 1, 30, 40, 16, 50, 60, 32]]);
  assert.equal(d.points, 3);
});

test('coordinates are clamped to the canvas; bad ops are dropped', () => {
  const d = newDrawing();
  const a = applyOps(d, [
    ['s', 1, 99, 0, 0, 0, 0],
    ['s', 1, 0, 9, 0, 0, 0],
    ['s', 2, 0, 0, -50, 900, 1.6],
    ['p', 2, 801.4, 12.7, 5, 'x', 3, 6],
    ['p', 7, 1, 1, 1],
    ['z'],
    'nonsense',
  ]);
  assert.deepEqual(a, [['s', 2, 0, 0, 0, 600, 2], ['p', 2, 800, 13, 5]]);
});

test('only the latest stroke grows', () => {
  const d = newDrawing();
  applyOps(d, [['s', 1, 0, 0, 1, 1, 0], ['s', 2, 0, 0, 5, 5, 0]]);
  assert.deepEqual(applyOps(d, [['p', 1, 9, 9, 9]]), []);
  assert.equal(applyOps(d, [['p', 2, 9, 9, 9]]).length, 1);
});

test('undo takes the latest action; clear is an action undo brings back', () => {
  const d = newDrawing();
  applyOps(d, [['s', 1, 0, 0, 1, 1, 0], ['p', 1, 2, 2, 1], ['x', 5]]);
  assert.equal(d.actions.length, 2);
  // A second clear in a row changes nothing.
  assert.deepEqual(applyOps(d, [['x', 6]]), []);
  applyOps(d, [['u']]);
  assert.deepEqual(d.actions.map((a) => a.k), ['s']);
  applyOps(d, [['u']]);
  assert.equal(d.actions.length, 0);
  assert.equal(d.points, 0);
  assert.deepEqual(applyOps(d, [['u']]), []);
});

test('a fill is accepted only when its runs cover the fill grid', () => {
  const d = newDrawing();
  const all = FILL_W * FILL_H;
  assert.equal(applyOps(d, [['f', 4, [100, 200, all - 300], 10]]).length, 1);
  assert.equal(applyOps(d, [['f', 4, [100, 200], 10]]).length, 0);
  assert.equal(applyOps(d, [['f', 4, [-1, all + 1], 10]]).length, 0);
  assert.equal(applyOps(d, [['f', 30, [all], 10]]).length, 0);
  assert.deepEqual(toOps(d), [['f', 4, [100, 200, all - 300], 10]]);
});

test('a stroke stops growing at its limit', () => {
  const d = newDrawing();
  applyOps(d, [['s', 1, 0, 0, 1, 1, 0]]);
  const many = [];
  for (let i = 0; i < 300; i++) many.push(1, 1, i);
  for (let k = 0; k < 25; k++) applyOps(d, [['p', 1, ...many]]);
  assert.equal(d.actions[0].pts.length / 3, INK_LIMITS.strokePoints);
});
