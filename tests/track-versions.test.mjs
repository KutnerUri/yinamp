import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaylistTracks } from '../src/library-data.js';
import { initialState } from '../src/core.js';
import { playbackTrack, versionMode, recordingControl } from '../src/track-versions.js';
import { queryTrackVersions } from '../music-versions.mjs';

const song = '9mWr4c_ig54', video = 'E0S4W34zFMA';
const row = (id, type, length = '3:07') => ({ videoId: id, title: { simpleText: 'Track' }, lengthText: { simpleText: length },
  navigationEndpoint: { watchEndpoint: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: type } } } } });
const queue = (primary, counterpart) => ({ playlistPanelRenderer: { contents: [{ playlistPanelVideoWrapperRenderer: {
  primaryRenderer: { playlistPanelVideoRenderer: primary },
  counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: counterpart } }],
} }] } });

test('Music queue preserves explicit counterparts and original queue identity in either direction', () => {
  for (const [primary, other] of [
    [row(song, 'MUSIC_VIDEO_TYPE_ATV'), row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30')],
    [row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30'), row(song, 'MUSIC_VIDEO_TYPE_ATV')],
  ]) {
    const tracks = parsePlaylistTracks(queue(primary, other)).tracks;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].id, primary.videoId);
    assert.deepEqual(tracks[0].versions, { song: { id: song, duration: 187 }, video: { id: video, duration: 210 } });
  }
});

test('live Music queue arrays retain pairs even when an earlier playlist copy has no pairing', () => {
  const wrapper = queue(row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30'), row(song, 'MUSIC_VIDEO_TYPE_ATV')).playlistPanelRenderer.contents[0];
  const sparse = { playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30') }] } };
  for (const data of [[sparse, [wrapper]], [[wrapper], sparse]]) {
    const result = parsePlaylistTracks(data).tracks;
    assert.equal(result.length, 1);
    assert.equal(result[0].id, video);
    assert.deepEqual(result[0].versions, { song: { id: song, duration: 187 }, video: { id: video, duration: 210 } });
  }
});

test('a counterpart with a known type identifies a primary whose rendered copy omits the type', () => {
  const data = queue(row(video, undefined, '3:30'), row(song, 'MUSIC_VIDEO_TYPE_ATV'));
  assert.deepEqual(parsePlaylistTracks(data).tracks[0].versions,
    { song: { id: song, duration: 187 }, video: { id: video, duration: 210 } });
});

test('unplayable, malformed, and unrelated queue entries never become counterparts', () => {
  for (const other of [row('invalid', 'MUSIC_VIDEO_TYPE_OMV'), { ...row(video, 'MUSIC_VIDEO_TYPE_OMV'), isPlayable: false }]) {
    assert.deepEqual(parsePlaylistTracks(queue(row(song, 'MUSIC_VIDEO_TYPE_ATV'), other)).tracks[0].versions,
      { song: { id: song, duration: 187 } });
  }
  const data = { playlistPanelRenderer: { contents: [
    { playlistPanelVideoRenderer: row(song, 'MUSIC_VIDEO_TYPE_ATV') },
    { playlistPanelVideoRenderer: row(video, 'MUSIC_VIDEO_TYPE_OMV') },
  ] } };
  assert.equal(parsePlaylistTracks(data).tracks[0].versions.video, undefined);
});

test('saved pairs survive validation and playback selection leaves queue IDs and durations intact', () => {
  const track = parsePlaylistTracks(queue(row(song, 'MUSIC_VIDEO_TYPE_ATV'), row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30'))).tracks[0];
  const state = initialState({ version: 2, playlist: [track], playbackMode: 'video' });
  const recording = playbackTrack(state.playlist[0], state.playbackMode, 42);
  assert.equal(recording.id, video); assert.equal(recording.start, 42); assert.equal(recording.duration, 210);
  assert.equal(state.playlist[0].id, song); assert.equal(state.playlist[0].duration, 187);
  assert.equal(versionMode(track, video), 'video');
  assert.equal(playbackTrack(track, 'unavailable').id, song);
  assert.equal(initialState({ playlist: [{ ...track, versions: { video: { id: 'invalid' } } }] }).playlist[0].versions, undefined);
});

test('lookup extracts only the requested pair, including when the requested ID is the counterpart', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (!options.method) return new Response('ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.test","visitorData":"private"});');
    const body = JSON.parse(options.body);
    assert.equal(body.videoId, video);
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.ok(!options.body.includes('private'));
    return Response.json(queue(row(song, 'MUSIC_VIDEO_TYPE_ATV'), row(video, 'MUSIC_VIDEO_TYPE_OMV', '3:30')));
  };
  const result = await queryTrackVersions({ id: video, fetcher });
  assert.equal(result.versions.song.id, song); assert.equal(result.versions.video.id, video);
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://music.youtube.com'));
  assert.equal(calls[1].options.signal, calls[0].options.signal);
  await assert.rejects(queryTrackVersions({ id: 'invalid', fetcher }), /Invalid/);
  assert.equal(calls.length, 2);
});

test('missing pairs stay unavailable and network failures are recoverable', async () => {
  const fetcher = async (_url, options) => options.method ? Response.json({}) : new Response('ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.test"});');
  assert.deepEqual(await queryTrackVersions({ id: song, fetcher }), { versions: {} });
  await assert.rejects(queryTrackVersions({ id: song, fetcher: async () => new Response('', { status: 503 }) }), /could not load/);
});

test('VID remains pressable on missing tracks, during loading and after errors; color follows playback independently', () => {
  const track = { id: song, versionsChecked: true };
  for (const options of [{}, { checking: true }, { switching: true }, { error: true }]) {
    const control = recordingControl(track, 'video', options);
    assert.equal(control.pressed, true); assert.equal(control.disabled, false); assert.equal(control.active, false);
  }
  assert.equal(recordingControl(null, 'video').disabled, false);
  assert.equal(recordingControl(track, 'song', { runningVideo: true }).pressed, false);
  assert.equal(recordingControl(track, 'song', { runningVideo: true }).active, true);
});

test('confirmed missing alternates and positive matches survive reload without repeat lookups', () => {
  const track = { id: song, versionsChecked: true, versions: { song: { id: song, duration: 187 } } };
  const state = initialState({ version: 2, playlist: [track], playbackMode: 'video' });
  assert.equal(state.playlist[0].versionsChecked, true);
  assert.equal(state.playbackMode, 'video');
  assert.equal(state.playlist[0].versions.song.id, song);
});

test('version lookup exposes music metadata only from the matching content ID', async () => {
  const typed = (text, pageType) => ({ text, navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } } });
  const matching = row(song, 'MUSIC_VIDEO_TYPE_ATV');
  matching.longBylineText = { runs: [typed('Artist', 'MUSIC_PAGE_TYPE_ARTIST'), typed('Album', 'MUSIC_PAGE_TYPE_ALBUM')] };
  const unrelated = row('IHHq6lAgZzs', 'MUSIC_VIDEO_TYPE_ATV');
  unrelated.longBylineText = { runs: [typed('Wrong artist', 'MUSIC_PAGE_TYPE_ARTIST')] };
  const fetcher = async (_url, options) => options.method ? Response.json({ playlistPanelRenderer: { contents: [{ playlistPanelVideoRenderer: unrelated }, { playlistPanelVideoRenderer: matching }] } }) : new Response('ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.test"});');
  const result = await queryTrackVersions({ id: song, fetcher });
  assert.equal(result.artist, 'Artist'); assert.equal(result.album, 'Album');
});
