import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPlaylistNavigation } from '../src/playlist-navigation.js';

test('navigation tracks visibility, reveals the song, and refreshes after edits without scroll measurements', t => {
  const savedFrame = globalThis.requestAnimationFrame;
  const savedObserver = globalThis.ResizeObserver;
  let frame, resize, reads = 0, rowTop = 300;
  globalThis.requestAnimationFrame = callback => { frame = callback; return 1; };
  globalThis.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} unobserve() {} };
  t.after(() => { globalThis.requestAnimationFrame = savedFrame; globalThis.ResizeObserver = savedObserver; });
  const events = {};
  const row = { getBoundingClientRect() { reads++; return { top: 102 + rowTop - list.scrollTop, height: 30 }; } };
  const list = { scrollTop: 0, clientHeight: 100, clientTop: 2,
    querySelector: () => row, getBoundingClientRect: () => ({ top: 100 }),
    addEventListener: (name, callback) => { events[name] = callback; } };
  const button = { disabled: true, dataset: {}, addEventListener: (name, callback) => { events[name] = callback; } };
  const refresh = setupPlaylistNavigation(list, button);
  refresh(); frame();
  assert.equal(button.dataset.direction, 'down');
  list.scrollTop = 220; events.scroll();
  assert.equal(button.disabled, true); // A partially visible row needs no arrow.
  list.scrollTop = 330; events.scroll();
  assert.equal(button.dataset.direction, 'up');
  assert.equal(reads, 1);
  assert.equal(button.disabled, false);
  events.click(); events.scroll();
  assert.equal(list.scrollTop, 265);
  assert.equal(button.disabled, true);
  const revealedTop = list.scrollTop;
  events.click();
  assert.equal(list.scrollTop, revealedTop); // Invisible buttons cannot navigate.
  assert.equal(button.dataset.visible, 'false');
  rowTop = 30; refresh(); frame();
  assert.equal(button.dataset.direction, 'up');
  list.clientHeight = 400; list.scrollTop = 0; resize(); frame();
  assert.equal(button.disabled, true);
  list.querySelector = () => null; refresh(); frame();
  assert.equal(button.disabled, true);
});
