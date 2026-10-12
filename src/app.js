import { STORAGE_KEY, SKINS, initialState, validateSkin, parseVideoInput, nextTrackIndex, formatTime, clamp } from './core.js';
import { YouTubePlayer } from './youtube.js';
import { setupPanels } from './panels.js';

const $ = selector => document.querySelector(selector);
let stored;
let storageAvailable = true;
try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { storageAvailable = false; }
const state = initialState(stored);
let playback = 'CONNECTING';
let seeking = false;
let stopped = false;
let hasError = false;
let wantsPlayback = false;
let noticeTimeout;
const currentTrack = () => state.playlist.find(track => track.id === state.selectedId);

function notify(message, error = false) {
  clearTimeout(noticeTimeout);
  $('#notice').textContent = message;
  $('#notice').dataset.error = String(error);
  noticeTimeout = setTimeout(() => { $('#notice').textContent = ''; }, 8000);
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { if (storageAvailable) notify('Browser storage is full or unavailable. Export your playlist to keep a copy.', true); storageAvailable = false; }
}

const player = new YouTubePlayer({
  onReady() {
    player.volume(state.volume, state.muted);
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTED';
    $('#connection-light').classList.add('connected');
    $('#video-placeholder').hidden = Boolean(currentTrack());
    playback = currentTrack() ? 'READY' : 'EMPTY';
    updatePlayback();
  },
  onState(code) {
    if (hasError) return;
    playback = ({ '-1': 'READY', 0: 'ENDED', 1: 'PLAYING', 2: stopped ? 'STOPPED' : 'PAUSED', 3: 'BUFFERING', 5: 'READY' })[code] ?? 'READY';
    wantsPlayback = code === 1 || code === 3;
    if (code === 0 && !stopped && currentTrack()) {
      const next = nextTrackIndex(state, { automatic: true });
      if (next >= 0) { selectTrack(state.playlist[next].id, true); return; }
    }
    if (!currentTrack()) playback = 'EMPTY';
    updatePlayback();
    updateProgress();
  },
  onError(message) {
    hasError = true;
    wantsPlayback = false;
    playback = 'UNAVAILABLE';
    $('#player-error-message').textContent = message;
    $('#player-error').hidden = false;
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> UNAVAILABLE';
    $('#connection-light').classList.remove('connected');
    updatePlayback();
    panels.refresh();
  },
  onAutoplayBlocked() {
    playback = 'PRESS PLAY';
    wantsPlayback = false;
    updatePlayback();
    notify('Your browser paused autoplay. Press play in the video window to start.');
  },
});

const bars = Array.from({ length: 20 }, () => document.createElement('span'));
$('#visualizer').append(...bars);
const panels = setupPanels(state, persist);

function renderSkin() {
  for (const [key, value] of Object.entries(state.skin.colors)) document.documentElement.style.setProperty(`--${key}`, value);
  $('meta[name="theme-color"]').content = state.skin.colors.desktop;
  $('#skin-name').textContent = `${state.skin.name.toUpperCase()} SKIN`;
  $('#custom-skin-name').value = state.skin.name;
  for (const input of document.querySelectorAll('[data-color]')) input.value = state.skin.colors[input.dataset.color];
  for (const button of document.querySelectorAll('[data-skin]')) button.setAttribute('aria-pressed', String(JSON.stringify(SKINS[button.dataset.skin].colors) === JSON.stringify(state.skin.colors)));
}
function updateModes() {
  $('#shuffle').setAttribute('aria-pressed', String(state.shuffle));
  $('#repeat').setAttribute('aria-pressed', String(state.repeat !== 'off'));
  $('#repeat').setAttribute('aria-label', `Repeat ${state.repeat}`);
  $('#repeat-label').textContent = state.repeat === 'one' ? 'REPEAT 1' : 'REPEAT';
  $('#mute').setAttribute('aria-pressed', String(state.muted));
  $('#volume').value = state.volume;
  $('#volume-value').textContent = state.muted ? 'MUTED' : `${Math.round(state.volume)}%`;
  for (const key of ['eq', 'playlist']) {
    $(`#${key}-panel`).hidden = !state.visibility[key];
    $(`#toggle-${key}`).setAttribute('aria-pressed', String(state.visibility[key]));
  }
  panels.refresh();
}
function updateTrack() {
  const track = currentTrack();
  $('#track-title').textContent = track?.title.toUpperCase() ?? 'YOUR PLAYLIST STARTS HERE';
  $('#track-title').title = track?.title ?? '';
  $('#youtube-link').hidden = !track;
  if (track) $('#youtube-link').href = `https://www.youtube.com/watch?v=${track.id}`;
  $('#video-placeholder').hidden = player.ready && Boolean(track);
  $('#video-placeholder-note').textContent = track ? 'Connecting to YouTube…' : 'Add a YouTube link to get started.';
  $('#time').textContent = '00:00';
  $('#duration').textContent = track?.duration ? formatTime(track.duration) : '--:--';
  $('#seek').value = 0;
  $('#seek').max = track?.duration || 100;
  $('#seek').disabled = true;
}
function updatePlayback() {
  $('#playback-state').textContent = playback;
  $('#play-indicator').textContent = playback === 'PLAYING' ? '▶' : playback === 'PAUSED' ? 'Ⅱ' : '■';
  document.body.classList.toggle('is-playing', playback === 'PLAYING');
  if (playback !== 'PLAYING') bars.forEach(bar => { bar.style.height = '3px'; });
  $('#play').setAttribute('aria-pressed', String(playback === 'PLAYING'));
  $('#pause').setAttribute('aria-pressed', String(playback === 'PAUSED'));
  const empty = !currentTrack();
  for (const id of ['play', 'pause', 'stop', 'previous', 'next']) $(`#${id}`).disabled = empty;
  document.title = playback === 'PLAYING' && currentTrack() ? `▶ ${currentTrack().title} — Yinamp` : 'Yinamp — Back to the desktop.';
}
function renderPlaylist() {
  const list = $('#playlist');
  const focused = document.activeElement;
  const focusedId = focused?.closest('[data-track-id]')?.dataset.trackId;
  const focusedAction = focused?.dataset.action;
  list.replaceChildren();
  state.playlist.forEach((track, index) => {
    const row = document.createElement('li');
    row.dataset.trackId = track.id;
    row.classList.toggle('current', track.id === state.selectedId);
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'track-select';
    select.dataset.action = 'select';
    select.setAttribute('aria-pressed', String(track.id === state.selectedId));
    select.setAttribute('aria-label', `Select ${track.title}`);
    for (const [className, text] of [['track-number', String(index + 1).padStart(2, '0') + '.'], ['track-name', track.title], ['track-duration', track.duration ? formatTime(track.duration) : '--:--']]) {
      const span = document.createElement('span'); span.className = className; span.textContent = text; select.append(span);
    }
    select.addEventListener('click', () => selectTrack(track.id, playback === 'PLAYING'));
    select.addEventListener('dblclick', () => selectTrack(track.id, true));
    const tools = document.createElement('div'); tools.className = 'track-tools';
    for (const [action, label, symbol] of [['up', 'Move up', '↑'], ['down', 'Move down', '↓'], ['remove', 'Remove', '×']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol; button.dataset.action = action;
      button.setAttribute('aria-label', `${label} ${track.title}`);
      button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === state.playlist.length - 1);
      button.addEventListener('click', () => action === 'remove' ? removeTrack(track.id) : moveTrack(track.id, action === 'up' ? -1 : 1));
      tools.append(button);
    }
    row.append(select, tools); list.append(row);
  });
  if (!state.playlist.length) { const empty = document.createElement('li'); empty.className = 'playlist-empty'; empty.textContent = 'Nothing queued. Add your first video.'; list.append(empty); }
  const total = state.playlist.reduce((sum, track) => sum + track.duration, 0);
  $('#playlist-summary').textContent = `${state.playlist.length} ${state.playlist.length === 1 ? 'TRACK' : 'TRACKS'}${total ? ` · ${formatTime(total)}` : ''}`;
  if (focusedId && focusedAction) list.querySelector(`[data-track-id="${focusedId}"] [data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
}
function clearPlayerError() {
  hasError = false;
  $('#player-error').hidden = true;
  $('#player-error-message').textContent = '';
  if (player.ready) { $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTED'; $('#connection-light').classList.add('connected'); }
  panels.refresh();
}
function selectTrack(id, autoplay = false) {
  const track = state.playlist.find(t => t.id === id);
  if (!track) return;
  clearPlayerError();
  state.selectedId = id;
  stopped = false;
  wantsPlayback = autoplay;
  playback = player.ready ? (autoplay ? 'BUFFERING' : 'READY') : 'CONNECTING';
  updateTrack(); renderPlaylist(); updatePlayback(); persist();
  player.load(track, autoplay);
}
function moveTrack(id, direction) {
  const index = state.playlist.findIndex(t => t.id === id);
  const destination = index + direction;
  if (destination < 0 || destination >= state.playlist.length) return;
  [state.playlist[index], state.playlist[destination]] = [state.playlist[destination], state.playlist[index]];
  renderPlaylist(); persist();
}
function removeTrack(id) {
  const index = state.playlist.findIndex(t => t.id === id);
  const wasPlaying = playback === 'PLAYING';
  state.playlist.splice(index, 1);
  if (state.selectedId === id) {
    const next = state.playlist[Math.min(index, state.playlist.length - 1)];
    if (next) selectTrack(next.id, wasPlaying);
    else { state.selectedId = null; stopped = true; wantsPlayback = false; playback = 'EMPTY'; clearPlayerError(); player.load(null); updateTrack(); updatePlayback(); }
  }
  renderPlaylist(); persist();
  notify('Track removed.');
}
function navigate(direction) {
  const index = nextTrackIndex(state, { direction });
  if (index >= 0) selectTrack(state.playlist[index].id, true);
}
function play() {
  if (!currentTrack()) return;
  if (hasError) { retryPlayer(); return; }
  stopped = false; wantsPlayback = true;
  if (player.ready) player.play();
  else { player.load(currentTrack(), true); notify('Connecting to YouTube…'); }
}
function pause() { wantsPlayback = false; if (!player.ready) player.load(currentTrack(), false); player.pause(); }
function stop() { stopped = true; wantsPlayback = false; player.stop(); if (!player.ready) player.load(currentTrack(), false); playback = currentTrack() ? 'STOPPED' : 'EMPTY'; updatePlayback(); $('#time').textContent = '00:00'; $('#seek').value = 0; }
function setVolume(value) { state.volume = clamp(value, 0, 100); state.muted = false; player.volume(state.volume, state.muted); updateModes(); persist(); }
function toggleMute() { state.muted = !state.muted; player.volume(state.volume, state.muted); updateModes(); persist(); }
function togglePanel(key) { state.visibility[key] = !state.visibility[key]; updateModes(); persist(); }
function retryPlayer() { clearPlayerError(); playback = 'CONNECTING'; updatePlayback(); $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTING'; $('#connection-light').classList.remove('connected'); $('#video-placeholder').hidden = false; $('#video-placeholder-note').textContent = 'Reconnecting to YouTube…'; player.initialize(); player.load(currentTrack(), false); }

function updateProgress() {
  if (!player.ready || hasError || !currentTrack()) return;
  const progress = player.progress();
  const track = currentTrack();
  if (progress.duration > 0 && Math.abs(track.duration - progress.duration) > 1) {
    track.duration = Math.round(progress.duration); renderPlaylist(); persist();
  }
  if (!seeking) {
    $('#time').textContent = formatTime(stopped ? 0 : progress.current);
    $('#time').parentElement.classList.toggle('long-time', progress.current >= 3600);
    $('#duration').textContent = progress.duration ? formatTime(progress.duration) : '--:--';
    $('#seek').max = progress.duration || 100;
    $('#seek').value = stopped ? 0 : progress.current;
    $('#seek').setAttribute('aria-valuetext', `${formatTime(progress.current)} of ${formatTime(progress.duration)}`);
    $('#seek').disabled = !progress.duration;
  }
  if (Number.isFinite(progress.volume) && (Math.round(progress.volume) !== Math.round(state.volume) || progress.muted !== state.muted)) {
    state.volume = progress.volume; state.muted = progress.muted; updateModes(); persist();
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  bars.forEach((bar, index) => { bar.style.height = playback === 'PLAYING' ? `${reducedMotion ? 6 + (index * 7 % 17) : 3 + Math.random() * 23}px` : '3px'; });
}

function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function openAdd() { $('#add-error').hidden = true; showDialog('add-dialog'); $('#video-url').focus(); }
for (const button of document.querySelectorAll('[data-dismiss]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#open-add').onclick = openAdd; $('#playlist-add').onclick = openAdd;
$('#open-skins').onclick = () => showDialog('skins-dialog'); $('#footer-skins').onclick = () => showDialog('skins-dialog');
$('#open-help').onclick = () => showDialog('help-dialog');
$('#reset-layout').onclick = () => { panels.reset(); notify('Windows arranged.'); };
$('#compact-main').onclick = () => { const body = $('#main-body'); body.hidden = !body.hidden; $('#compact-main').setAttribute('aria-expanded', String(!body.hidden)); panels.refresh(); };
$('#fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#video-viewport').requestFullscreen(); } catch { notify('Use the fullscreen button inside the YouTube video on this browser.'); } };
$('#play').onclick = play; $('#pause').onclick = pause; $('#stop').onclick = stop;
$('#next').onclick = () => navigate(1); $('#previous').onclick = () => navigate(-1);
$('#volume').oninput = event => setVolume(event.target.value);
$('#mute').onclick = toggleMute;
$('#shuffle').onclick = () => { state.shuffle = !state.shuffle; updateModes(); persist(); };
$('#repeat').onclick = () => { state.repeat = { off: 'all', all: 'one', one: 'off' }[state.repeat]; updateModes(); persist(); notify(`Repeat ${state.repeat}.`); };
$('#toggle-eq').onclick = () => togglePanel('eq'); $('#toggle-playlist').onclick = () => togglePanel('playlist');
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => togglePanel(button.dataset.close);
$('#retry-player').onclick = retryPlayer;
$('#seek').oninput = event => { seeking = true; $('#time').textContent = formatTime(event.target.value); };
$('#seek').onchange = event => { stopped = false; player.seek(Number(event.target.value)); seeking = false; };
$('#seek').addEventListener('pointercancel', () => { seeking = false; });
$('#seek').addEventListener('blur', () => { seeking = false; });

$('#add-form').onsubmit = event => {
  event.preventDefault();
  let parsed;
  try { parsed = parseVideoInput($('#video-url').value); }
  catch (error) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; return; }
  if (state.playlist.some(track => track.id === parsed.id)) { selectTrack(parsed.id); $('#add-dialog').close(); notify('That video is already in your playlist. Selected it for you.'); return; }
  if (state.playlist.length >= 500) { $('#add-error').textContent = 'Your playlist is full (500 tracks). Remove a track first.'; $('#add-error').hidden = false; return; }
  const title = $('#video-title').value.trim();
  const track = { ...parsed, title: title || `YouTube — ${parsed.id}`, duration: 0 };
  state.playlist.push(track);
  const first = !state.selectedId;
  if (first) selectTrack(track.id);
  else { renderPlaylist(); persist(); }
  $('#add-dialog').close(); $('#add-form').reset(); notify('Added to your playlist.');
  if (!title) fetch(`/api/video?id=${encodeURIComponent(track.id)}`).then(response => response.ok ? response.json() : null).then(data => {
    if (!data || !state.playlist.includes(track)) return;
    track.title = data.title; renderPlaylist(); if (state.selectedId === track.id) { $('#track-title').textContent = track.title.toUpperCase(); $('#track-title').title = track.title; updatePlayback(); } persist();
  }).catch(() => { /* A title lookup never prevents playback. */ });
};

for (const button of document.querySelectorAll('[data-skin]')) button.onclick = () => { state.skin = structuredClone(SKINS[button.dataset.skin]); renderSkin(); persist(); };
for (const [key, label] of Object.entries({ accent: 'LED / accent', shell: 'Window', edge: 'Bevel', screen: 'Display', text: 'Text', button: 'Controls', desktop: 'Desktop' })) {
  const field = document.createElement('label'); field.textContent = label;
  const input = document.createElement('input'); input.type = 'color'; input.dataset.color = key; input.setAttribute('aria-label', label);
  input.oninput = () => { state.skin.colors[key] = input.value; renderSkin(); persist(); };
  field.append(input); $('#skin-colors').append(field);
}
$('#custom-skin-name').oninput = event => { state.skin.name = event.target.value.trim() || 'Custom'; $('#skin-name').textContent = `${state.skin.name.toUpperCase()} SKIN`; persist(); };
$('#export-skin').onclick = () => download(state.skin, `yinamp-${state.skin.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'custom'}.json`);
$('#import-skin').onclick = () => $('#skin-file').click();
$('#skin-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 65536) throw new Error('Skin files must be smaller than 64 KB.');
    state.skin = validateSkin(JSON.parse(await file.text()));
    $('#skin-error').hidden = true; renderSkin(); persist(); notify(`Loaded ${state.skin.name}.`);
  } catch (error) { $('#skin-error').textContent = error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message; $('#skin-error').hidden = false; }
};
$('#export-playlist').onclick = () => download({ version: 1, name: 'Yinamp playlist', tracks: state.playlist }, 'yinamp-playlist.json');
$('#import-playlist').onclick = () => $('#playlist-file').click();
$('#playlist-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 1048576) throw new Error('Playlist files must be smaller than 1 MB.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.tracks) || data.tracks.length > 500 || data.tracks.some(track => !track || !/^[\w-]{11}$/.test(track.id))) throw new Error('Use a Yinamp playlist JSON file with up to 500 valid videos.');
    const imported = initialState({ playlist: data.tracks });
    stop(); state.playlist = imported.playlist; state.selectedId = imported.selectedId;
    if (currentTrack()) selectTrack(state.selectedId);
    else { player.load(null); playback = 'EMPTY'; updateTrack(); renderPlaylist(); updatePlayback(); persist(); }
    notify(`Loaded ${state.playlist.length} tracks.`);
  } catch (error) { notify(error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message, true); }
};

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  const actions = { ' ': () => playback === 'PLAYING' || wantsPlayback ? pause() : play(), ArrowLeft: () => player.seek(Math.max(0, player.progress().current - 5)), ArrowRight: () => player.seek(player.progress().current + 5), ArrowUp: () => setVolume(state.volume + 5), ArrowDown: () => setVolume(state.volume - 5), m: toggleMute, n: () => navigate(1), p: () => navigate(-1) };
  const action = actions[event.key] ?? actions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

renderSkin(); updateModes(); renderPlaylist(); updateTrack(); updatePlayback();
player.load(currentTrack(), false);
player.initialize();
setInterval(updateProgress, 350);
if (!storageAvailable) notify('Browser storage is unavailable. Use SAVE to export your playlist.', true);
window.addEventListener('pagehide', () => { persist(); });
