import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubePlayer } from '../src/youtube.js';

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
