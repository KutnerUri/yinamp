import test from 'node:test';
import assert from 'node:assert/strict';
import { YOUTUBE_PARTITION, INTERFACE_PARTITION, accountURL, isAccountURL, watchURL, isYouTubeURL, isExternalURL, viewBounds, validateCommand } from '../electron/contracts.mjs';
import { controlPage, readPage, didProviderAdvance } from '../electron/page-scripts.mjs';

test('recording switches load or cue the existing player and paused cues retain their position', t => {
  const previous = { document: globalThis.document, location: globalThis.location };
  const calls = [];
  let id = 'ZIDqxZKqTK4', time = 0, state = 2;
  const video = { paused: true, readyState: 0, duration: NaN, currentTime: 0, volume: 1, muted: false };
  const player = {
    classList: { contains: () => false }, getVideoData: () => ({ video_id: id }), getPlayerState: () => state, getCurrentTime: () => time,
    cueVideoById(value) { calls.push(['cue', value]); id = value.videoId; time = value.startSeconds; state = 5; },
    loadVideoById(value) { calls.push(['load', value]); id = value.videoId; time = value.startSeconds; state = 1; },
    playVideo() { calls.push(['play']); state = 1; },
  };
  globalThis.document = { querySelector: selector => selector === '#movie_player' ? player : selector.includes('video') ? video : null };
  globalThis.location = { href: 'https://www.youtube.com/watch?v=ZIDqxZKqTK4' };
  t.after(() => Object.assign(globalThis, previous));
  assert.deepEqual(controlPage({ type: 'switch', id: 'kgcUJumE2J0', start: 42, autoplay: false }), { switched: true });
  const snapshot = readPage();
  assert.equal(snapshot.id, 'kgcUJumE2J0'); assert.equal(snapshot.current, 42); assert.equal(snapshot.state, 5); assert.equal(snapshot.ready, true);
  controlPage({ type: 'play' });
  controlPage({ type: 'switch', id: 'ZIDqxZKqTK4', start: 45, autoplay: true });
  assert.deepEqual(calls, [['cue', { videoId: 'kgcUJumE2J0', startSeconds: 42 }], ['play'], ['load', { videoId: 'ZIDqxZKqTK4', startSeconds: 45 }]]);
  assert.equal(globalThis.location.href, 'https://www.youtube.com/watch?v=ZIDqxZKqTK4');
});

test('provider auto-advance reports the ended recording before the player changes its ID', t => {
  const previous = { document: globalThis.document, location: globalThis.location, video: globalThis.__yinampEndVideo };
  let id = 'ZIDqxZKqTK4', ended;
  const video = { readyState: 4, duration: 170, paused: false, volume: 1, addEventListener(type, callback, capture) {
    assert.equal(type, 'ended'); assert.equal(capture, true); ended = callback;
  } };
  const player = { getVideoData: () => ({ video_id: id }), classList: { contains: () => false } };
  globalThis.document = { querySelector: selector => selector === '#movie_player' ? player : selector.includes('video') ? video : null };
  globalThis.location = { href: 'https://music.youtube.com/watch?v=ZIDqxZKqTK4' };
  t.after(() => { globalThis.document = previous.document; globalThis.location = previous.location; globalThis.__yinampEndVideo = previous.video; delete globalThis.__yinampEndedId; });
  readPage(); ended(); id = 'kgcUJumE2J0';
  const snapshot = readPage();
  assert.equal(snapshot.id, 'kgcUJumE2J0'); assert.equal(snapshot.endedId, 'ZIDqxZKqTK4');
  assert.equal(readPage().endedId, undefined, 'End notifications are delivered once');
});

test('recording-switch IPC validates IDs, times, autoplay and native modes', () => {
  const command = { type: 'switch', id: 'kgcUJumE2J0', start: 42, autoplay: false, mode: 'song' };
  assert.equal(validateCommand(command), command);
  for (const change of [{ id: 'invalid' }, { start: NaN }, { start: -1 }, { autoplay: 'yes' }, { mode: 'other' }]) assert.throws(() => validateCommand({ ...command, ...change }));
});

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
  assert.equal(accountURL('switch'), 'https://www.youtube.com/channel_switcher');
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

 test('desktop graph volume is independent from source volume and used in snapshots', t => {
  const previous = {document:globalThis.document,location:globalThis.location,graph:globalThis.__yinampAudio};
  const video={volume:1,muted:false,currentTime:10,duration:200,readyState:4,paused:false};
  const graph={volume:37,muted:true,setVolume(value,muted){this.volume=value;this.muted=muted;},attach(){}};
  globalThis.__yinampAudio=graph;
  globalThis.document={querySelector:selector=>selector.includes('video')?video:null};globalThis.location={href:'https://www.youtube.com/watch?v=IHHq6lAgZzs'};
  t.after(()=>{globalThis.document=previous.document;globalThis.location=previous.location;if(previous.graph===undefined)delete globalThis.__yinampAudio;else globalThis.__yinampAudio=previous.graph;});
  assert.equal(readPage().volume,37);assert.equal(readPage().muted,true);
  controlPage({type:'volume',value:0,muted:false});assert.equal(graph.volume,0);assert.equal(video.volume,1);assert.equal(video.muted,false);
 });

test('only actual endings advance the queue, not provider navigation or ads', () => {
  assert.equal(didProviderAdvance({ id: 'kgcUJumE2J0' }, 'ZIDqxZKqTK4', true, true), false);
  assert.equal(didProviderAdvance({ id: 'kgcUJumE2J0' }, 'ZIDqxZKqTK4', false, true), false);
  assert.equal(didProviderAdvance({ id: 'ZIDqxZKqTK4' }, 'ZIDqxZKqTK4', true, true), false);
  assert.equal(didProviderAdvance({ id: 'kgcUJumE2J0' }, 'ZIDqxZKqTK4', true, false), false);
  assert.equal(didProviderAdvance({ id: 'kgcUJumE2J0', isAd: true }, 'ZIDqxZKqTK4', true, true), false);
});

test('actual end markers and ended requested media finish the track',()=>{
 assert.equal(didProviderAdvance({id:'kgcUJumE2J0',endedId:'ZIDqxZKqTK4'},'ZIDqxZKqTK4',true,true),true);
 assert.equal(didProviderAdvance({id:'ZIDqxZKqTK4',state:0},'ZIDqxZKqTK4',true,true),true);
 assert.equal(didProviderAdvance({id:'ZIDqxZKqTK4',state:0,isAd:true},'ZIDqxZKqTK4',true,true),false);
});


test('desktop fallback applies zero after provider unmute restores its minimum', t => {
  const previous = globalThis.document;
  t.after(() => { globalThis.document = previous; });
  let volume = 5;
  const video = {};
  const player = {
    unMute() { volume = 5; },
    setVolume(value) { volume = value; },
  };
  globalThis.document = { querySelector: selector => selector === '#movie_player' ? player : video };
  controlPage({ type: 'volume', value: 0, muted: false });
  assert.equal(volume, 0);
});
