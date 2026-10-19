import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubePlayer } from '../src/youtube.js';

function startupFixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location, setTimeout, clearTimeout };
  const timers = new Map(), players = [], errors = [];
  let serial = 0, ready = 0, blocked = 0;
  globalThis.setTimeout = (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  class FakePlayer {
    constructor(id, options) { this.options = options; players.push(this); }
    getIframe() { return { setAttribute() {} }; }
    destroy() { this.destroyed = true; }
    cueVideoById() {}
    loadVideoById() {}
    ready() { this.options.events.onReady({ target: this }); }
  }
  globalThis.window = { YT: { Player: FakePlayer } };
  globalThis.document = { getElementById: () => ({ replaceChildren() {} }), createElement: () => ({}) };
  globalThis.location = { origin: 'http://127.0.0.1:5173' };
  const adapter = new YouTubePlayer({ onReady: () => ready++, onState() {}, onError: (...args) => errors.push(args), onAutoplayBlocked: () => blocked++ });
  t.after(() => { adapter.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return { adapter, players, errors, timers, ready: () => ready, blocked: () => blocked };
}

test('two silent attempts stop after one automatic reconnect and allow manual Retry', async t => {
  const f = startupFixture(t);
  f.adapter.load({ id: 'K4DyBUG242c' }, false);
  await f.adapter.initialize();
  const old = f.players[0];
  [...f.timers.values()].find(timer => timer.delay === 6000).callback();
  await Promise.resolve();
  assert.equal(f.players.length, 2);
  assert.equal(f.errors.length, 0);
  assert.equal(old.destroyed, true);
  [...f.timers.values()].find(timer => timer.delay === 6000).callback();
  assert.equal(f.adapter.initializing, false);
  assert.equal(f.adapter.ready, false);
  assert.equal(old.destroyed, true);
  assert.match(f.errors[0][0], /Retry/);
  old.ready();
  f.players[1].ready();
  assert.equal(f.ready(), 0);
  await f.adapter.initialize();
  f.players[2].ready();
  assert.equal(f.adapter.ready, true);
  assert.equal(f.ready(), 1);
  assert.equal(f.timers.size, 0);
});

test('automatic reconnect preserves the latest track and Pause cancels pending autoplay', async t => {
  const f = startupFixture(t);
  f.adapter.load({ id: 'K4DyBUG242c' }, true);
  await f.adapter.initialize();
  f.adapter.load({ id: 'J2X5mJ3HDYE', start: 65 }, true);
  [...f.timers.values()].find(timer => timer.delay === 6000).callback();
  await Promise.resolve();
  assert.equal(f.players[1].options.videoId, 'J2X5mJ3HDYE');
  assert.equal(f.players[1].options.playerVars.start, 65);
  assert.equal(f.adapter.pending.autoplay, true);
  f.adapter.pause();
  assert.equal(f.adapter.pending.autoplay, false);
  f.players[1].ready();
  assert.equal(f.adapter.ready, true);
  assert.equal(f.errors.length, 0);
  assert.equal(f.timers.size, 0);
});

test('destroy cancels a delayed reconnect after a transient constructor failure', async t => {
  const f = startupFixture(t);
  window.YT.Player = class { constructor() { throw new Error('temporary startup failure'); } };
  await f.adapter.initialize();
  assert.equal(f.errors.length, 0);
  assert.equal(f.timers.size, 1);
  const retry = [...f.timers.values()][0].callback;
  f.adapter.destroy();
  assert.equal(f.timers.size, 0);
  retry();
  assert.equal(f.adapter.initializing, false);
});

test('a reconnect replaces a hung API script instead of awaiting the same promise', async t => {
  const f = startupFixture(t);
  const scripts = [];
  window.YT = undefined;
  document.createElement = () => ({ remove() { this.removed = true; } });
  document.head = { append: script => scripts.push(script) };
  const { YouTubePlayer: FreshPlayer } = await import('../src/youtube.js?hung-api');
  const adapter = new FreshPlayer({ onReady() {}, onState() {}, onError: (...args) => f.errors.push(args), onAutoplayBlocked() {} });
  t.after(() => adapter.destroy());
  const first = adapter.initialize();
  [...f.timers.values()].find(timer => timer.delay === 6000).callback();
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].removed, true);
  await first;
  assert.equal(f.errors.length, 0);
  [...f.timers.values()].find(timer => timer.delay === 6000).callback();
  assert.equal(f.errors.length, 1);
  assert.equal(f.timers.size, 0);
});

test('Retry replaces an unfinished attempt and ignores its stale events', async t => {
  const f = startupFixture(t);
  await f.adapter.initialize();
  await f.adapter.initialize();
  assert.equal(f.players.length, 2);
  assert.equal(f.players[0].destroyed, true);
  f.players[0].ready();
  f.players[0].options.events.onError({ data: 150 });
  f.players[0].options.events.onAutoplayBlocked();
  assert.equal(f.ready(), 0);
  assert.equal(f.errors.length, 0);
  assert.equal(f.blocked(), 0);
  f.players[1].ready();
  assert.equal(f.ready(), 1);
});

test('an iframe startup error releases initialization and cancels the watchdog', async t => {
  const f = startupFixture(t);
  await f.adapter.initialize();
  f.players[0].options.events.onError({ data: 153 });
  assert.equal(f.adapter.initializing, false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.errors[0][1].code, 153);
  await f.adapter.initialize();
  f.players[1].ready();
  assert.equal(f.adapter.ready, true);
});

test('a throwing existing API hook cannot leave API loading pending forever', async t => {
  const f = startupFixture(t);
  const scripts = [];
  window.YT = undefined;
  window.onYouTubeIframeAPIReady = () => { throw new Error('another consumer failed'); };
  document.head = { append: script => scripts.push(script) };
  const { loadYouTubeAPI } = await import('../src/youtube.js?throwing-hook');
  const loading = loadYouTubeAPI();
  const api = window.YT = { Player() {} };
  window.onYouTubeIframeAPIReady();
  assert.equal(await loading, api);
  assert.equal(f.timers.size, 0);
});

test('failed API loading restores its hook and permits a fresh script attempt', async t => {
  const f = startupFixture(t);
  const scripts = [];
  window.YT = undefined;
  const previous = window.onYouTubeIframeAPIReady = () => {};
  document.createElement = () => ({ remove() { this.removed = true; } });
  document.head = { append: script => scripts.push(script) };
  const { loadYouTubeAPI } = await import('../src/youtube.js?retry-api');
  const loading = loadYouTubeAPI();
  const lateReady = window.onYouTubeIframeAPIReady;
  scripts[0].onerror();
  await assert.rejects(loading, /Retry/);
  assert.equal(window.onYouTubeIframeAPIReady, previous);
  assert.equal(scripts[0].removed, true);
  const retry = loadYouTubeAPI();
  assert.equal(scripts.length, 2);
  lateReady();
  const api = window.YT = { Player() {} };
  window.onYouTubeIframeAPIReady();
  assert.equal(await retry, api);
  assert.equal(f.timers.size, 0);
});

async function fixture(t) {
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location };
  const calls = [];
  class FakePlayer {
    constructor(id, options) { this.options = options; setTimeout(() => options.events.onReady({ target: this }), 0); }
    getIframe() { return { setAttribute() {} }; }
    cueVideoById(parameters) { calls.push(['cue', parameters]); }
    loadVideoById(parameters) { calls.push(['load', parameters]); }
    playVideo() { calls.push(['play']); }
    pauseVideo() { calls.push(['pause']); }
    destroy() {}
    emit(code) { this.options.events.onStateChange({ data: code }); }
  }
  globalThis.window = { YT: { Player: FakePlayer } };
  globalThis.document = { getElementById: () => ({ replaceChildren() {} }), createElement: () => ({}) };
  globalThis.location = { origin: 'http://127.0.0.1:5173' };
  let ready;
  const promise = new Promise(resolve => { ready = resolve; });
  const adapter = new YouTubePlayer({ onReady: ready, onState() {}, onError() {}, onAutoplayBlocked() {} });
  t.after(() => { adapter.destroy(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  adapter.load({ id: 'K4DyBUG242c', start: 0 }, false);
  await adapter.initialize(); await promise;
  return { adapter, calls };
}
test('Play requested during an asynchronous cue is retained until YouTube reports the video ready', async t => {
  const { adapter, calls } = await fixture(t);
  adapter.load({ id: 'J2X5mJ3HDYE', start: 65 }, false);
  adapter.play();
  assert.equal(calls.filter(call => call[0] === 'play').length, 0);
  adapter.player.emit(5);
  assert.equal(calls.filter(call => call[0] === 'play').length, 1);
  adapter.player.emit(5);
  assert.equal(calls.filter(call => call[0] === 'play').length, 1, 'The pending request is consumed once');
});
test('Pause cancels a queued play request, and initialization avoids cueing the initial video twice', async t => {
  const { adapter, calls } = await fixture(t);
  assert.equal(adapter.player.options.videoId, 'K4DyBUG242c');
  assert.equal(calls.length, 0, 'The initial video is loaded by the iframe constructor');
  adapter.load({ id: 'J2X5mJ3HDYE' }, false);
  adapter.play(); adapter.pause(); adapter.player.emit(5);
  assert.equal(calls.filter(call => call[0] === 'play').length, 0);
});


test('zero volume is applied after unmute restores a provider level', () => {
  let volume = 5;
  const calls = [];
  const adapter = Object.create(YouTubePlayer.prototype);
  adapter.ready = true;
  adapter.player = {
    unMute() { calls.push('unmute'); volume = 5; },
    setVolume(value) { calls.push(value); volume = value; },
  };
  adapter.volume(0, false);
  assert.equal(volume, 0);
  assert.deepEqual(calls, ['unmute', 0]);
});
