import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistListing } from '../playlist-listing.mjs';
import { playlistPage } from './fixtures/playlist.mjs';
const modern = (id, title) => ({ lockupViewModel: { contentId: id, contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: title } } } } });

test('reads modern public playlist rows, preserves order, and excludes sidebar recommendations', () => {
  const result = parsePlaylistListing(playlistPage([modern('c8fu7tkc2Iw', 'First { title } "quoted"'), modern('IHHq6lAgZzs', 'Second'), modern('c8fu7tkc2Iw', 'Duplicate')]), 'PL_public');
  assert.deepEqual(result.tracks.map(track => track.id), ['c8fu7tkc2Iw', 'IHHq6lAgZzs']);
  assert.equal(result.tracks[0].title, 'First { title } "quoted"');
  assert.equal(result.partial, false);
});
test('reads older playlist rows, skips unavailable videos, and reports continuation pages', () => {
  const html = playlistPage([{ playlistVideoRenderer: { videoId: 'c8fu7tkc2Iw', title: { runs: [{ text: 'First' }] }, isPlayable: true } }, { playlistVideoRenderer: { videoId: 'IHHq6lAgZzs', isPlayable: false } }, { continuationItemRenderer: {} }], { legacy: true });
  const result = parsePlaylistListing(html, 'PL_public');
  assert.equal(result.tracks.length, 1);
  assert.equal(result.partial, true);
});
test('does not interpret private, malformed, empty, or different playlist pages as imports', () => {
  assert.throws(() => parsePlaylistListing('<html>Sign in</html>', 'PL_public'));
  assert.throws(() => parsePlaylistListing('var ytInitialData = {bad', 'PL_public'));
  assert.throws(() => parsePlaylistListing(playlistPage([]), 'PL_public'));
  assert.throws(() => parsePlaylistListing(playlistPage([modern('c8fu7tkc2Iw', 'First')], { id: 'PL_other' }), 'PL_public'));
});
