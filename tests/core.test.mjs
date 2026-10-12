import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoInput, initialState, nextTrackIndex, validateSkin, SKINS, formatTime } from '../src/core.js';

test('video links preserve valid timestamps across supported YouTube surfaces', () => {
  for (const link of ['https://www.youtube.com/watch?v=M7lc1UVf-VE&t=1h2m3s', 'youtu.be/M7lc1UVf-VE?t=3723', 'https://music.youtube.com/watch?v=M7lc1UVf-VE&start=3723', 'https://www.youtube.com/shorts/M7lc1UVf-VE?t=3723', 'https://www.youtube.com/live/M7lc1UVf-VE?t=3723', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=3723']) assert.deepEqual(parseVideoInput(link), { id: 'M7lc1UVf-VE', start: 3723 });
  assert.deepEqual(parseVideoInput('  M7lc1UVf-VE  '), { id: 'M7lc1UVf-VE', start: 0 });
});
test('rejects arbitrary hosts, lookalikes, scripts, and playlist-only URLs', () => {
  for (const link of ['https://example.com/watch?v=M7lc1UVf-VE', 'https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://youtube.com@evil.test/watch?v=M7lc1UVf-VE', 'javascript:alert(1)', 'https://youtube.com/playlist?list=123', 'https://youtube.com/watch?v=bad']) assert.throws(() => parseVideoInput(link));
});
test('shuffle never chooses the current track and repeat respects queue endings', () => {
  const state = initialState();
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
test('the default playlist survives a saved-state round trip', () => {
  const state = initialState();
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
