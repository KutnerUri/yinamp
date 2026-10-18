import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAPIResponse } from '../src/pages-api.js';
import { appendPlaylistTracks, DEFAULT_TRACKS } from '../src/core.js';

const request = path => demoAPIResponse(new URL(path, 'https://example.github.io'));

test('demo discovery cards open their available track selections without a playlist server', async () => {
  const discovery = await request('/api/library?section=discover').json();
  assert.equal(discovery.items.length, 4);
  assert.match(discovery.items[0].title, /Madonna/);
  assert.match(discovery.items[1].title, /Limp Bizkit/);
  assert.equal(discovery.items[2].title, 'Cautiously Optimistic');
  assert.equal(discovery.items[3].title, 'Indie to make love to');
  for (const card of discovery.items) {
    // This source takes the existing app's metadata API path, avoiding iframe enumeration.
    assert.equal(card.source, 'music');
    assert.equal(card.kind, 'playlist');
    assert.equal(card.tracks, undefined);
    const response = request(`/api/playlist?id=${encodeURIComponent(card.id)}&source=music`);
    assert.equal(response.status, 200);
    const playlist = await response.json();
    assert.equal(playlist.title, card.title);
    assert.equal(playlist.partial, card.partial === true);
    assert.ok(playlist.tracks.length > 0);
    const queued = appendPlaylistTracks([], playlist.tracks.map(track => track.id));
    assert.equal(queued.added.length, playlist.tracks.length);
    for (const track of playlist.tracks) {
      assert.ok(track.title && !track.title.startsWith('YouTube —'));
      assert.ok(track.duration > 2);
      assert.equal((await request(`/api/video?id=${track.id}`).json()).title, track.title);
    }
  }
  assert.deepEqual(DEFAULT_TRACKS, []);
});

test('static demo does not pretend to search or expose personal libraries', async () => {
  for (const path of ['/api/search?q=Madonna', '/api/playlist?id=unknown', '/api/library?section=mine']) {
    const response = request(path);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /local app/);
  }
  assert.deepEqual(await request('/api/search-suggestions?q=Madonna').json(), []);
});
