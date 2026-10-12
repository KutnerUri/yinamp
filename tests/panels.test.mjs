import test from 'node:test';
import assert from 'node:assert/strict';
import { setupPanels } from '../src/panels.js';

test('panel layout reads dimensions before writes and dragging flushes the latest frame before saving', t => {
  const keys = ['document', 'window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  let written = false, lateReads = 0, writes = 0, nextFrame = 0, saves = 0;
  const frames = new Map();
  function element(name, height) {
    const values = new Map(), listeners = new Map();
    const handle = { addEventListener: (type, callback) => listeners.set(type, callback), setPointerCapture() {} };
    return {
      dataset: { panel: name }, hidden: false, listeners,
      style: {
        getPropertyValue: key => values.get(key) ?? '',
        setProperty(key, value) { written = true; writes++; values.set(key, value); },
      },
      get offsetWidth() { if (written) lateReads++; return 340; },
      get offsetHeight() { if (written) lateReads++; return height; },
      classList: { add() {}, remove() {} },
      addEventListener() {}, querySelector: () => handle,
    };
  }
  const panels = [element('main', 200), element('eq', 100), element('video', 250), element('playlist', 300), element('library', 300)];
  const desktop = {
    querySelectorAll: () => panels,
    get clientWidth() { if (written) lateReads++; return 1000; },
    style: { set height(value) { written = true; } },
  };
  globalThis.document = { getElementById: () => desktop };
  globalThis.window = { matchMedia: () => ({ matches: true }), addEventListener() {} };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  const state = { layout: {} };
  const controls = setupPanels(state, () => saves++);
  assert.equal(lateReads, 0, 'Initial layout groups all size reads before position writes');
  written = false; controls.refresh();
  assert.equal(lateReads, 0, 'Refreshing layout also groups measurements');
  const handle = panels[0].listeners;
  handle.get('pointerdown')({ button: 0, target: { closest: () => null }, clientX: 0, clientY: 0, pointerId: 1, preventDefault() {} });
  const previousWrites = writes;
  handle.get('pointermove')({ clientX: 40, clientY: 20 });
  handle.get('pointermove')({ clientX: 80, clientY: 50 });
  assert.equal(frames.size, 1);
  assert.equal(writes, previousWrites, 'Pointer events defer position writes');
  written = false; flush();
  assert.equal(lateReads, 0, 'Dragging measures before writing');
  assert.equal(panels[0].style.getPropertyValue('--x'), '80px');
  handle.get('pointermove')({ clientX: 90, clientY: 60 });
  written = false; handle.get('pointerup')();
  assert.equal(frames.size, 0);
  assert.deepEqual(state.layout.main, { x: 90, y: 60 }, 'Releasing before the frame saves the final pointer position');
  assert.equal(saves, 1);
  assert.equal(lateReads, 0);
});
