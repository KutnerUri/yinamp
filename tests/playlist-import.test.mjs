import test from 'node:test';
import assert from 'node:assert/strict';
import { readOnlinePlaylist, readPlaylistWithFallback } from '../src/playlist-import.js';

function fixture(t, { ids = [], readyDelay = 0 } = {}) {
  const previous = { window: globalThis.window, document: globalThis.document, location: globalThis.location };
  let preview;
  class FakePreview {
    constructor(target, options) {
      this.options = options;
      this.ids = ids;
      this.destroyed = false;
      preview = this;
      setTimeout(() => options.events.onReady({ target: this }), readyDelay);
    }
    getIframe() { return { setAttribute() {} }; }
    getPlaylist() { return this.ids; }
    destroy() { this.destroyed = true; }
  }
  globalThis.window = { YT: { Player: FakePreview } };
  globalThis.document = { createElement: () => ({}) };
  globalThis.location = { origin: 'http://127.0.0.1:5173' };
  const container = { children: [], replaceChildren(...children) { this.children = children; } };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  return { container, preview: () => preview };
}

test('reads the playlist in owner order and destroys the temporary preview', async t => {
  const { container, preview } = fixture(t, { ids: ['K4DyBUG242c', 'invalid', 'M7lc1UVf-VE'] });
  const ids = await readOnlinePlaylist('PL_example', { container });
  assert.deepEqual(ids, ['K4DyBUG242c', 'M7lc1UVf-VE']);
  assert.equal(preview().options.playerVars.list, 'PL_example');
  assert.equal(preview().options.playerVars.autoplay, 0);
  assert.equal(preview().destroyed, true);
  assert.deepEqual(container.children, []);
});
test('empty or inaccessible playlists time out without leaking a preview', async t => {
  const { container, preview } = fixture(t);
  await assert.rejects(readOnlinePlaylist('PL_empty', { container, timeout: 20 }), /private, empty, or unavailable/);
  assert.equal(preview().destroyed, true);
  assert.deepEqual(container.children, []);
});
test('cancellation destroys a loading preview and late ready events do not restart polling', async t => {
  const { container, preview } = fixture(t, { readyDelay: 20 });
  const controller = new AbortController();
  const result = readOnlinePlaylist('PL_cancel', { container, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
  assert.equal(preview().destroyed, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(container.children, []);
});
test('a playlist can still import IDs when its first video rejects embedded playback', async t => {
  const { container, preview } = fixture(t, { readyDelay: 40 });
  const result = readOnlinePlaylist('PL_mixed', { container });
  await new Promise(resolve => setTimeout(resolve, 0));
  preview().ids = ['M7lc1UVf-VE'];
  preview().options.events.onError({ data: 101 });
  assert.deepEqual(await result, ['M7lc1UVf-VE']);
  assert.equal(preview().destroyed, true);
});
test('an embedding error before IDs arrive falls back to the public listing', async t => {
  const { container, preview } = fixture(t);
  const requests = [];
  const result = readPlaylistWithFallback('PL_public', { container, fetcher: async url => { requests.push(url); return { ok: true, status: 200, json: async () => ({ tracks: [{ id: 'c8fu7tkc2Iw', title: 'First' }, { id: 'IHHq6lAgZzs', title: 'Second' }], partial: false }) }; } });
  await new Promise(resolve => setTimeout(resolve, 0));
  preview().options.events.onError({ data: 150 });
  const source = await result;
  assert.deepEqual(source.ids, ['c8fu7tkc2Iw', 'IHHq6lAgZzs']);
  assert.equal(source.tracks[0].title, 'First');
  assert.deepEqual(requests, ['/api/playlist?id=PL_public']);
});
test('cancelling an import never starts the listing fallback', async t => {
  const { container } = fixture(t, { readyDelay: 20 });
  const controller = new AbortController();
  const result = readPlaylistWithFallback('PL_public', { container, signal: controller.signal, fetcher: () => { throw new Error('Should not fetch'); } });
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
});
