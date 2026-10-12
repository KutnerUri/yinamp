import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebouncedSave } from '../src/persistence.js';

test('continuous settings changes save only the latest state after the quiet period', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let volume = 10;
  const saved = [], persistence = createDebouncedSave(() => saved.push(volume));
  persistence.schedule(); t.mock.timers.tick(200);
  volume = 80; persistence.schedule(); t.mock.timers.tick(200);
  assert.deepEqual(saved, []);
  t.mock.timers.tick(50);
  assert.deepEqual(saved, [80]);
});

test('leaving the app flushes pending changes once and cancels the delayed save', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let saves = 0;
  const persistence = createDebouncedSave(() => saves++);
  persistence.flush(); assert.equal(saves, 0);
  persistence.schedule(); persistence.flush(); persistence.flush();
  assert.equal(saves, 1);
  t.mock.timers.tick(1000); assert.equal(saves, 1);
});
