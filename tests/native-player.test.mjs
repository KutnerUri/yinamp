import test from 'node:test';
import assert from 'node:assert/strict';
import { NativePlayer } from '../src/native-player.js';

test('native video follows scroll and layout events once per frame, skips unchanged bounds, and cleans up', t => {
  const keys = ['document', 'window', 'innerHeight', 'MutationObserver', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  const events = () => {
    const listeners = new Map();
    return {
      listeners,
      addEventListener(type, callback) { listeners.set(type, callback); },
      removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
      emit(type) { listeners.get(type)?.(); },
    };
  };
  let top = 100, reads = 0, nextFrame = 0;
  const frames = new Map(), calls = [], observers = [];
  const panel = {
    dataset: { panel: 'video' },
    getBoundingClientRect() { reads++; return { left: 30, top, right: 350, bottom: top + 240, width: 320, height: 240 }; },
  };
  const placeholder = { hidden: true };
  const body = { classList: { contains: () => false } };
  globalThis.document = {
    ...events(), body,
    getElementById: id => id === 'video-viewport' ? panel : id === 'video-placeholder' ? placeholder : body,
    querySelector: () => null,
    querySelectorAll: () => [panel],
  };
  globalThis.window = events();
  globalThis.innerHeight = 800;
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.disconnected = true; }
  }
  globalThis.MutationObserver = Observer;
  globalThis.ResizeObserver = Observer;
  globalThis.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const player = Object.create(NativePlayer.prototype);
  player.bridge = { layout: bounds => calls.push(bounds) };
  player.trackLayout();
  flush();
  assert.equal(calls.length, 1);
  top = 40;
  document.emit('scroll'); document.emit('scroll'); window.emit('resize');
  assert.equal(frames.size, 1);
  assert.equal(reads, 1, 'Measurements wait for the scheduled frame');
  flush();
  assert.equal(calls.at(-1).y, 42, 'Scrolling updates the native view position');
  observers[1].callback(); flush();
  assert.equal(calls.length, 2, 'Unchanged bounds do not cross the bridge');
  observers[0].callback([{ type: 'attributes', attributeName: 'style', target: {} }]);
  assert.equal(frames.size, 0, 'Unrelated animation styles do not schedule measurements');
  top = 70;
  observers[0].callback([{ type: 'attributes', attributeName: 'style', target: panel }]); flush();
  assert.equal(calls.at(-1).y, 72, 'Panel position styles trigger updates');
  placeholder.hidden = false;
  observers[0].callback([{ type: 'attributes', attributeName: 'hidden', target: placeholder }]); flush();
  assert.equal(calls.at(-1).visible, false);
  document.emit('scroll');
  player.destroy();
  assert.equal(frames.size, 0);
  assert.equal(document.listeners.size, 0);
  assert.equal(window.listeners.size, 0);
  assert.ok(observers.every(observer => observer.disconnected));
});
