import test from 'node:test';
import assert from 'node:assert/strict';
import { YOUTUBE_PARTITION, INTERFACE_PARTITION, accountURL, isAccountURL, watchURL, isYouTubeURL, isExternalURL, viewBounds, validateCommand } from '../electron/contracts.mjs';
import { controlPage, readPage } from '../electron/page-scripts.mjs';

test('desktop transport constructs only normal YouTube watch URLs', () => {
  assert.equal(watchURL('IHHq6lAgZzs'), 'https://www.youtube.com/watch?v=IHHq6lAgZzs');
  assert.equal(watchURL('c8fu7tkc2Iw', 65), 'https://www.youtube.com/watch?v=c8fu7tkc2Iw&t=65');
  assert.throws(() => watchURL('https://evil.test'));
  assert.equal(isYouTubeURL('https://www.youtube.com/watch?v=IHHq6lAgZzs'), true);
  assert.equal(isYouTubeURL('https://youtube.com.evil.test'), false);
  assert.equal(isExternalURL('file:///etc/passwd'), false);
  assert.equal(isExternalURL('javascript:alert(1)'), false);
  assert.equal(isExternalURL('https://accounts.google.com'), true);
});
test('native view bounds stay inside the window and IPC commands validate their arguments', () => {
  assert.deepEqual(viewBounds({ x: -1, y: 40, width: 3000, height: 3000 }, { width: 1000, height: 800 }), { x: 0, y: 40, width: 1000, height: 760 });
  assert.throws(() => viewBounds({ x: NaN }, { width: 1000, height: 800 }));
  assert.throws(() => validateCommand({ type: 'eval', code: 'bad' }));
  assert.throws(() => validateCommand({ type: 'volume', value: 200 }));
  assert.throws(() => validateCommand({ type: 'seek', value: -5 }));
  assert.throws(() => validateCommand({ type: 'load', id: 'file:///etc/passwd' }));
});
test('account navigation stays within HTTPS Google and YouTube pages, in a separate persistent session', () => {
  assert.notEqual(YOUTUBE_PARTITION, INTERFACE_PARTITION);
  assert.ok(YOUTUBE_PARTITION.startsWith('persist:'));
  assert.equal(accountURL('open'), 'https://www.youtube.com/account');
  assert.equal(new URL(accountURL('switch')).hostname, 'accounts.google.com');
  assert.throws(() => accountURL('https://evil.test'));
  for (const url of ['https://accounts.google.com/v3/signin', 'https://www.youtube.com/account', 'https://myaccount.google.com/']) assert.equal(isAccountURL(url), true);
  for (const url of ['https://accounts.google.com.evil.test/', 'https://accounts.google.com@evil.test/', 'http://accounts.google.com/', 'file:///etc/passwd', 'javascript:alert(1)']) assert.equal(isAccountURL(url), false);
});
test('page bridge changes play/pause, seeking, stop, and volume through the HTML media element', async t => {
  const previous = globalThis.document;
  const video = { paused: true, currentTime: 30, duration: 200, volume: .75, muted: false, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  globalThis.document = { querySelector: () => video };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  await controlPage({ type: 'play' }); assert.equal(video.paused, false);
  controlPage({ type: 'pause' }); assert.equal(video.paused, true);
  controlPage({ type: 'seek', value: 999 }); assert.equal(video.currentTime, 200);
  controlPage({ type: 'volume', value: 35, muted: true }); assert.equal(video.volume, .35); assert.equal(video.muted, true);
  controlPage({ type: 'stop' }); assert.equal(video.currentTime, 0); assert.equal(video.paused, true);
});
test('advertisement playback does not advance the user playlist or overwrite track duration', t => {
  const previous = { document: globalThis.document, location: globalThis.location };
  const video = { currentTime: 10, duration: 30, volume: .75, paused: false, ended: true, readyState: 4 };
  globalThis.document = { querySelector: selector => selector === '#movie_player' ? { classList: { contains: () => true } } : selector.includes('video') ? video : null };
  globalThis.location = { href: 'https://www.youtube.com/watch?v=IHHq6lAgZzs' };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const snapshot = readPage();
  assert.equal(snapshot.isAd, true); assert.equal(snapshot.state, 3); assert.equal(snapshot.duration, 0); assert.equal(snapshot.current, 0);
});
test('the volume bridge uses YouTube’s user-facing level instead of normalized media volume', t => {
  const previous = { document: globalThis.document, location: globalThis.location };
  const video = { currentTime: 0, duration: 200, volume: .25, muted: false, paused: true, readyState: 4 };
  const player = { level: 75, classList: { contains: () => false }, getVolume() { return this.level; }, setVolume(value) { this.level = value; }, isMuted() { return video.muted; }, mute() { video.muted = true; }, unMute() { video.muted = false; } };
  globalThis.document = { querySelector: selector => selector === '#movie_player' ? player : selector.includes('video') ? video : null };
  globalThis.location = { href: 'https://www.youtube.com/watch?v=IHHq6lAgZzs' };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  assert.equal(readPage().volume, 75);
  controlPage({ type: 'volume', value: 37, muted: true });
  assert.equal(player.level, 37); assert.equal(readPage().volume, 37); assert.equal(video.muted, true);
});
