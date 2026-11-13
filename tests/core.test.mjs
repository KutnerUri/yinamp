import test from 'node:test';
import assert from 'node:assert/strict';
import { RETRY_AFTER_MS, LEGACY_DEMO_TRACKS, canAttemptTrack, parseVideoInput, parseYouTubeInput, appendPlaylistTracks, initialState, nextTrackIndex, validateSkin, SKINS, formatTime, removeFromPlaylist, restoreToPlaylist, playlistDisplay, expireGhost } from '../src/core.js';

const sampleState = () => initialState({version:2,playlist:structuredClone(LEGACY_DEMO_TRACKS),selectedId:LEGACY_DEMO_TRACKS[0].id});

test('video links preserve valid timestamps across supported YouTube surfaces', () => {
  for (const link of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1h2m3s', 'youtu.be/M7lc1UVf-VE?t=3723', 'https://music.youtube.com/watch?v=M7lc1UVf-VE&start=3723', 'https://www.youtube.com/shorts/M7lc1UVf-VE?t=3723', 'https://www.youtube.com/live/M7lc1UVf-VE?t=3723', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=3723']) assert.deepEqual(parseVideoInput(link), { id: 'M7lc1UVf-VE', start: 3723 });
  assert.deepEqual(parseVideoInput('  M7lc1UVf-VE  '), { id: 'M7lc1UVf-VE', start: 0 });
});
test('rejects arbitrary hosts, lookalikes, scripts, and playlist-only URLs', () => {
  for (const link of ['https://example.com/watch?v=M7lc1UVf-VE', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://youtube.com@evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', 'https://youtube.com/playlist?list=123', 'https://youtube.com/watch?v=bad']) assert.throws(() => parseVideoInput(link));
});
test('playlist links are distinguished from videos, including watch links carrying a playlist', () => {
  assert.deepEqual(parseYouTubeInput('https://www.youtube.com/playlist?list=PL_example-123'), { type: 'playlist', playlistId: 'PL_example-123', video: null });
  assert.deepEqual(parseYouTubeInput('https://music.youtube.com/watch?v=M7lc1UVf-VE&list=PL_example-123&t=65'), { type: 'playlist', playlistId: 'PL_example-123', video: { id: 'M7lc1UVf-VE', start: 65 } });
  assert.deepEqual(parseYouTubeInput('https://youtu.be/M7lc1UVf-VE?list=PL_example-123'), { type: 'playlist', playlistId: 'PL_example-123', video: { id: 'M7lc1UVf-VE', start: 0 } });
  assert.deepEqual(parseYouTubeInput('M7lc1UVf-VE'), { type: 'video', id: 'M7lc1UVf-VE', start: 0 });
  for (const value of ['https://youtube.com.evil.test/playlist?list=PL_test', 'https://youtube.com/playlist?list=', 'https://youtube.com/playlist?list=abc%20def', 'https://youtube.com/playlist?list=' + 'a'.repeat(151)]) assert.throws(() => parseYouTubeInput(value));
});
test('playlist append preserves existing tracks and source order, skips duplicates, and reports limits', () => {
  const existing = [{ id: 'M7lc1UVf-VE', title: 'Keep my title', duration: 100 }];
  const result = appendPlaylistTracks(existing, ['M7lc1UVf-VE', 'J2X5mJ3HDYE', 'J2X5mJ3HDYE', 'invalid', 'K4DyBUG242c', 'jK2aIUmmdP4'], 3);
  assert.deepEqual(result.added.map(track => track.id), ['J2X5mJ3HDYE', 'K4DyBUG242c']);
  assert.equal(result.duplicates, 1);
  assert.equal(result.overflow, 1);
  assert.equal(existing.length, 1);
  assert.equal(existing[0].title, 'Keep my title');
  assert.deepEqual(appendPlaylistTracks(existing, ['M7lc1UVf-VE']).added, []);
});
test('shuffle never chooses the current track and repeat respects queue endings', () => {
  const state = sampleState();
  state.shuffle = true;
  for (const random of [0, .1, .5, .999999, 1]) assert.notEqual(nextTrackIndex(state, { random: () => random }), 0);
  state.shuffle = false;
  state.selectedId = state.playlist.at(-1).id;
  assert.equal(nextTrackIndex(state, { automatic: true }), -1);
  assert.equal(nextTrackIndex(state), 0);
  state.repeat = 'all'; assert.equal(nextTrackIndex(state, { automatic: true }), 0);
  state.repeat = 'one'; assert.equal(nextTrackIndex(state, { automatic: true }), 2);
  assert.equal(nextTrackIndex(state), 0);
  state.playlist = []; assert.equal(nextTrackIndex(state), -1);
});
test('navigation skips recent failures, retries expired marks, and respects the end of a pass', () => {
  const state = sampleState();
  const now = Date.now();
  state.playlist[1].unavailable = { code: 150, message: 'Blocked', checkedAt: now };
  assert.equal(nextTrackIndex(state, { now }), 2);
  assert.equal(nextTrackIndex(state, { automatic: true, now }), 2);
  assert.equal(canAttemptTrack(state.playlist[1], now + RETRY_AFTER_MS - 1), false);
  assert.equal(nextTrackIndex(state, { automatic: true, now: now + RETRY_AFTER_MS }), 1);
  state.selectedId = state.playlist[2].id;
  state.playlist[2].unavailable = { code: 100, message: 'Unavailable', checkedAt: now };
  assert.equal(nextTrackIndex(state, { automatic: true, skipCurrent: true, now }), -1);
  state.repeat = 'all';
  assert.equal(nextTrackIndex(state, { automatic: true, skipCurrent: true, now }), 0);
});
test('repeat-one and shuffle cannot loop over an entirely unavailable queue', () => {
  const state = sampleState(); const now = Date.now();
  for (const track of state.playlist) track.unavailable = { code: 150, checkedAt: now };
  for (const repeat of ['off', 'all', 'one']) {
    state.repeat = repeat;
    for (const shuffle of [true, false]) {
      state.shuffle = shuffle;
      assert.equal(nextTrackIndex(state, { automatic: true, skipCurrent: true, now }), -1);
      assert.equal(nextTrackIndex(state, { now }), -1);
    }
  }
  delete state.playlist[2].unavailable;
  assert.equal(nextTrackIndex(state, { automatic: true, skipCurrent: true, now }), 2);
});
test('unavailable marks survive persistence while connection errors and corrupt marks do not', () => {
  const state = sampleState(); const now = Date.now();
  state.playlist[0].unavailable = { code: 150, message: 'Embedding disabled', checkedAt: now };
  state.playlist[1].unavailable = { code: 153, message: 'Connection', checkedAt: now };
  state.playlist[2].unavailable = { code: 100, message: 'Deleted', checkedAt: Infinity };
  const restored = initialState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.playlist[0].unavailable, state.playlist[0].unavailable);
  assert.equal(restored.playlist[1].unavailable, undefined);
  assert.equal(restored.playlist[2].unavailable.checkedAt, 0);
});
test('recovers corrupted persisted settings without losing a deliberately empty playlist', () => {
  const saved = { playlist: [{ id: 'M7lc1UVf-VE', title: '<script>bad</script>', duration: -9 }, { id: 'bad' }, { id: 'M7lc1UVf-VE' }, null], selectedId: 'deleted', volume: 900, repeat: 'invalid', skin: { version: 99 }, layout: { main: { x: -9, y: Infinity } } };
  const state = initialState(saved);
  assert.equal(state.playlist.length, 1);
  assert.equal(state.selectedId, 'M7lc1UVf-VE');
  assert.equal(state.playlist[0].duration, 0);
  assert.equal(state.volume, 100);
  assert.equal(state.repeat, 'off');
  assert.deepEqual(state.skin, SKINS.classic);
  assert.deepEqual(state.layout, {});
  assert.equal(initialState({ playlist: [] }).playlist.length, 0);
  assert.equal(initialState({ playlist: [] }).selectedId, null);
});
test('a deliberately selected playlist survives a saved-state round trip', () => {
  const state = sampleState();
  const restored = initialState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored.playlist.map(track => track.id), state.playlist.map(track => track.id));
});
test('skin imports whitelist the supported tokens and require actual hex colors', () => {
  assert.deepEqual(validateSkin(SKINS.amber), SKINS.amber);
  const bad = structuredClone(SKINS.classic); bad.colors.accent = 'url(https://evil.test)';
  assert.throws(() => validateSkin(bad));
  assert.throws(() => validateSkin({ version: 1, name: 'Incomplete', colors: {} }));
  const extra = structuredClone(SKINS.ice); extra.colors.extra = 'invalid';
  assert.equal(validateSkin(extra).colors.extra, undefined);
});
test('duration formatting handles hours, unknown values, and negative values', () => {
  assert.equal(formatTime(65.9), '01:05');
  assert.equal(formatTime(3723), '1:02:03');
  assert.equal(formatTime(-1), '00:00');
  assert.equal(formatTime(undefined), '00:00');
});

test('new users start empty and legacy demo prefixes are removed once', () => {
  assert.deepEqual(initialState().playlist, []); assert.equal(initialState().selectedId, null);
  const extra={id:'IHHq6lAgZzs',title:'My song',duration:100};
  const migrated=initialState({playlist:[...LEGACY_DEMO_TRACKS,extra],selectedId:extra.id,volume:43});
  assert.deepEqual(migrated.playlist.map(track=>track.id),[extra.id]);assert.equal(migrated.volume,43);
  const deliberate=initialState({version:2,playlist:LEGACY_DEMO_TRACKS});assert.equal(deliberate.playlist.length,3);
  assert.equal(initialState({playlist:[extra,LEGACY_DEMO_TRACKS[0]]}).playlist.length,2);
});

test('saved queues preserve bounded music metadata without inventing missing fields', () => {
  const state = initialState({ version: 2, playlist: [
    { id: 'IHHq6lAgZzs', title: 'Song', artist: ' Artist ', album: 'Album' },
    { id: 'c8fu7tkc2Iw', title: 'Unknown', artist: {}, album: '   ' },
    { id: 'M7lc1UVf-VE', artist: 'a'.repeat(400), album: 'b'.repeat(400) },
  ] });
  assert.equal(state.playlist[0].artist, 'Artist'); assert.equal(state.playlist[0].album, 'Album');
  assert.equal(state.playlist[1].artist, undefined); assert.equal(state.playlist[1].album, undefined);
  assert.equal(state.playlist[2].artist.length, 300); assert.equal(state.playlist[2].album.length, 300);
  assert.deepEqual(initialState(JSON.parse(JSON.stringify(state))).playlist, state.playlist);
});

test('playlist identity survives restarts only for a nonempty valid queue', () => {
  const playlist = [{ id: 'M7lc1UVf-VE', title: 'Song' }];
  const activePlaylist = { id: 'PL_known', title: 'My playlist', source: 'music' };
  const restored = initialState({ version: 2, playlist, activePlaylist });
  assert.deepEqual(restored.activePlaylist, activePlaylist);
  assert.deepEqual(initialState(JSON.parse(JSON.stringify(restored))).activePlaylist, activePlaylist);
  assert.equal(initialState({ version: 2, playlist }).activePlaylist, null);
  assert.equal(initialState({ version: 2, playlist: [], activePlaylist }).activePlaylist, null);
  assert.equal(initialState({ version: 2, playlist, activePlaylist: { id: '<invalid>' } }).activePlaylist, null);
});

const ids = ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd', 'eeeeeeeeeee'];
const queue = (count = 4) => ids.slice(0, count).map(id => ({ id, title: id, duration: 0 }));
const shown = (playlist, ghosts) => playlistDisplay(playlist, ghosts).map(entry => (entry.ghost ? '~' : '') + entry.track.id[0]).join('');

test('removed tracks stay in place as ghosts and undo restores each slot, in any order', () => {
  const orders = [[1, 2], [2, 1]];
  for (const removeOrder of orders) for (const undoOrder of orders) for (const extra of [false, true]) {
    const playlist = queue(), ghosts = [];
    const removed = {};
    for (const i of (extra ? [...removeOrder, 0] : removeOrder)) ghosts.push(removed[i] = removeFromPlaylist(playlist, ids[i], ghosts));
    assert.equal(shown(playlist, ghosts), extra ? '~a~b~cd' : 'a~b~cd');
    for (const i of undoOrder) assert.ok(restoreToPlaylist(playlist, ghosts, removed[i]) >= 0);
    if (extra) assert.ok(restoreToPlaylist(playlist, ghosts, removed[0]) >= 0);
    assert.deepEqual(playlist.map(t => t.id), ids.slice(0, 4), `remove ${removeOrder} undo ${undoOrder} extra ${extra}`);
    assert.equal(ghosts.length, 0);
  }
});

test('ghosts follow their neighbors, survive expiry of an anchor, and refuse unsafe restores', () => {
  let playlist = queue(), ghosts = [];
  const b = removeFromPlaylist(playlist, ids[1], ghosts); ghosts.push(b);
  playlist.unshift(playlist.pop());
  assert.equal(shown(playlist, ghosts), 'da~bc', 'stays after its previous track when the queue is reordered');
  assert.equal(restoreToPlaylist(playlist, ghosts, b), 2);
  assert.equal(restoreToPlaylist(playlist, ghosts, b), -1, 'undo only once');

  playlist = queue(); ghosts = [];
  const first = removeFromPlaylist(playlist, ids[1], ghosts); ghosts.push(first);
  const second = removeFromPlaylist(playlist, ids[2], ghosts); ghosts.push(second);
  expireGhost(ghosts, first);
  assert.equal(shown(playlist, ghosts), 'a~cd', 'inherits the anchor of an expired ghost');
  assert.equal(restoreToPlaylist(playlist, ghosts, second), 1);

  playlist = queue(); ghosts = [];
  assert.equal(removeFromPlaylist(playlist, 'zzzzzzzzzzz', ghosts), null);
  const a = removeFromPlaylist(playlist, ids[0], ghosts); ghosts.push(a);
  assert.equal(a.prevId, null);
  playlist.push({ id: ids[0], title: 're-added', duration: 0 });
  assert.equal(restoreToPlaylist(playlist, ghosts, a), -1, 'already back in the queue');
  const full = queue(3), fullGhost = removeFromPlaylist(full, ids[0], []);
  assert.equal(restoreToPlaylist(full, [fullGhost], fullGhost, 2), -1, 'full queue');
});
