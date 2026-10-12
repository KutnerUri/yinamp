import { STORAGE_KEY, SKINS, TRACK_ERROR_CODES, canAttemptTrack, initialState, validateSkin, parseYouTubeInput, appendPlaylistTracks, nextTrackIndex, formatTime, clamp } from './core.js';
import { YouTubePlayer } from './youtube.js';
import { setupVisualizer } from './visualizer.js';
import { NativePlayer } from './native-player.js';
import { setupPanels } from './panels.js';
import { readPlaylistWithFallback } from './playlist-import.js';
import { renderAccount } from './account-ui.js';
import { setupMusicLibrary } from './library-ui.js';
import { batch } from '@preact/signals-core';
import { createPlayerUI, savedPlayerState, bindPlayerUI } from './player-ui.js';
import { createDebouncedSave } from './persistence.js';

const $ = selector => document.querySelector(selector);
let stored;
let storageAvailable = true;
try { stored = window.yinampDesktop ? await window.yinampDesktop.readState() : JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { storageAvailable = false; }
const state = initialState(stored);
function resetEmbedFailures(tracks) { if (window.yinampDesktop) for (const track of tracks) if ([101, 150].includes(track.unavailable?.code)) delete track.unavailable; }
resetEmbedFailures(state.playlist);
const ui = createPlayerUI(state);
const snapshot = () => savedPlayerState(state, ui);
let seeking = false;
let stopped = false;
let hasError = false;
let wantsPlayback = false;
let noticeTimeout;
let playlistImport;
let playbackRequested = false;
let skipTimer;
let retryingId = null;
let musicLibrary;
const currentTrack = () => state.playlist.find(track => track.id === ui.selectedId.value);

function notify(message, error = false) {
  clearTimeout(noticeTimeout);
  $('#notice').textContent = message;
  $('#notice').dataset.error = String(error);
  noticeTimeout = setTimeout(() => { $('#notice').textContent = ''; }, 8000);
}
const persistence = createDebouncedSave(saveState);
const persist = persistence.schedule;
function saveState() {
  const saved = snapshot();
  try {
    if (window.yinampDesktop) window.yinampDesktop.saveState(saved).catch(() => notify('Desktop settings could not be saved. Use SAVE to export a copy.', true));
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  }
  catch { if (storageAvailable) notify('Browser storage is full or unavailable. Export your playlist to keep a copy.', true); storageAvailable = false; }
}

const visualizer = setupVisualizer($('#visualizer'));
$('#visualizer').setAttribute('aria-label', window.yinampDesktop ? 'Live music spectrum' : 'Audio spectrum unavailable for embedded YouTube playback');
const Player = window.yinampDesktop ? NativePlayer : YouTubePlayer;
const player = new Player({
  onSpectrum: data => visualizer.update(data),
  onReady() {
    player.volume(ui.volume.value, ui.muted.value);
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTED';
    $('#connection-light').classList.add('connected');
    $('#video-placeholder').hidden = Boolean(currentTrack());
    if (!currentTrack()) $('#video-placeholder-note').textContent = 'Choose a playlist from your library or add a song.';
    ui.playback.value = currentTrack() ? 'READY' : 'EMPTY';
  },
  onState(code) {
    if (hasError) return;
    ui.playback.value = ({ '-1': 'READY', 0: 'ENDED', 1: 'PLAYING', 2: stopped ? 'STOPPED' : 'PAUSED', 3: 'BUFFERING', 5: 'READY' })[code] ?? 'READY';
    wantsPlayback = code === 1 || code === 3;
    if (code === 1) {
      playbackRequested = true;
      retryingId = null;
      if (currentTrack()?.unavailable) { delete currentTrack().unavailable; renderPlaylist(); persist(); }
    }
    if (code === 2) { playbackRequested = false; clearTimeout(skipTimer); }
    if (code === 0 && !stopped && currentTrack()) {
      const next = nextTrackIndex(snapshot(), { automatic: true });
      if (next >= 0) { selectTrack(state.playlist[next].id, true); return; }
      playbackRequested = false;
    }
    if (!currentTrack()) ui.playback.value = 'EMPTY';
    updateProgress();
  },
  onError(message, { code } = {}) {
    visualizer.update();
    const track = currentTrack();
    const continueQueue = playbackRequested;
    clearTimeout(skipTimer);
    retryingId = null;
    hasError = true;
    wantsPlayback = false;
    ui.playback.value = 'UNAVAILABLE';
    $('#player-error-message').textContent = message;
    $('#player-error').hidden = false;
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> UNAVAILABLE';
    $('#connection-light').classList.remove('connected');
    panels.refresh();
    if (track && TRACK_ERROR_CODES.has(code)) {
      track.unavailable = { code, message, checkedAt: Date.now() };
      renderPlaylist(); persist();
      if (continueQueue) {
        const failedId = track.id;
        skipTimer = setTimeout(() => {
          if (!playbackRequested || ui.selectedId.value !== failedId) return;
          const next = nextTrackIndex(snapshot(), { automatic: true, skipCurrent: true });
          if (next >= 0) { notify(`Skipped unavailable video: ${track.title}`); selectTrack(state.playlist[next].id, true); }
          else {
            playbackRequested = false; stopped = true; player.pause();
            ui.playback.value = state.playlist.some(value => canAttemptTrack(value)) ? 'QUEUE FINISHED' : 'NO PLAYABLE TRACKS';
            $('#player-error-message').textContent = `${message} No playable tracks remain in this pass. Use a track’s Retry button to try again.`;
            notify('Playback stopped. Unavailable tracks stay in your playlist for a later retry.');
          }
        }, 450);
      }
    } else { playbackRequested = false; }
  },
  onAutoplayBlocked() {
    ui.playback.value = 'PRESS PLAY';
    wantsPlayback = false;
    playbackRequested = false;
    notify('Your browser paused autoplay. Press play in the video window to start.');
  },
});

const panels = setupPanels(state, persist);

function renderSkin() {
  for (const [key, value] of Object.entries(state.skin.colors)) document.documentElement.style.setProperty(`--${key}`, value);
  $('meta[name="theme-color"]').content = state.skin.colors.desktop;
  $('#skin-name').textContent = `${state.skin.name.toUpperCase()} SKIN`;
  $('#custom-skin-name').value = state.skin.name;
  for (const input of document.querySelectorAll('[data-color]')) input.value = state.skin.colors[input.dataset.color];
  for (const button of document.querySelectorAll('[data-skin]')) button.setAttribute('aria-pressed', String(JSON.stringify(SKINS[button.dataset.skin].colors) === JSON.stringify(state.skin.colors)));
}
function updateTrack() {
  const track = currentTrack();
  ui.trackTitle.value = track?.title ?? '';
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
function renderPlaylist() {
  const list = $('#playlist');
  const focused = document.activeElement;
  const focusedId = focused?.closest('[data-track-id]')?.dataset.trackId;
  const focusedAction = focused?.dataset.action;
  list.replaceChildren();
  state.playlist.forEach((track, index) => {
    const row = document.createElement('li');
    row.dataset.trackId = track.id;
    row.classList.toggle('current', track.id === ui.selectedId.value);
    row.classList.toggle('unavailable', Boolean(track.unavailable));
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'track-select';
    select.dataset.action = 'select';
    select.setAttribute('aria-pressed', String(track.id === ui.selectedId.value));
    select.setAttribute('aria-label', `Select ${track.title}`);
    const number = document.createElement('span'); number.className = 'track-number'; number.textContent = String(index + 1).padStart(2, '0') + '.';
    const copy = document.createElement('span'); copy.className = 'track-copy';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.title; name.title = track.title; copy.append(name);
    if (track.unavailable) {
      const status = document.createElement('span'); status.className = 'track-availability'; status.textContent = retryingId === track.id ? 'RETRYING…' : 'UNAVAILABLE'; status.title = track.unavailable.message; copy.append(status);
    }
    const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = track.duration ? formatTime(track.duration) : '--:--';
    select.append(number, copy, duration);
    select.addEventListener('click', () => selectTrack(track.id, ui.playback.value === 'PLAYING'));
    select.addEventListener('dblclick', () => selectTrack(track.id, true));
    const tools = document.createElement('div'); tools.className = 'track-tools';
    if (track.unavailable) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = '↻'; retry.dataset.action = 'retry'; retry.setAttribute('aria-label', `Retry ${track.title}`); retry.title = 'Retry this video'; retry.onclick = () => retryTrack(track.id);
      const open = document.createElement('a'); open.textContent = '↗'; open.href = `https://www.youtube.com/watch?v=${track.id}`; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.setAttribute('aria-label', `Open ${track.title} on YouTube`); open.title = 'Open on YouTube';
      tools.append(retry, open);
    }
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
  const unavailableCount = state.playlist.filter(track => track.unavailable).length;
  $('#playlist-summary').textContent = `${state.playlist.length} ${state.playlist.length === 1 ? 'TRACK' : 'TRACKS'}${unavailableCount ? ` · ${unavailableCount} UNAVAILABLE` : total ? ` · ${formatTime(total)}` : ''}`;
  $('#retry-unavailable').hidden = !unavailableCount;
  if (focusedId && focusedAction) list.querySelector(`[data-track-id="${focusedId}"] [data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
}
function clearPlayerError() {
  const wasVisible = !$('#player-error').hidden;
  hasError = false;
  $('#player-error').hidden = true;
  $('#player-error-message').textContent = '';
  if (player.ready) { $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTED'; $('#connection-light').classList.add('connected'); }
  if (wasVisible) panels.refresh();
}
function selectTrack(id, autoplay = false) {
  const track = state.playlist.find(t => t.id === id);
  if (!track) return;
  clearTimeout(skipTimer);
  clearPlayerError();
  visualizer.update();
  stopped = false;
  wantsPlayback = autoplay;
  playbackRequested = autoplay;
  if (retryingId) {
    const status = $(`#playlist [data-track-id="${retryingId}"] .track-availability`);
    if (status) status.textContent = 'UNAVAILABLE';
  }
  retryingId = track.unavailable && autoplay ? id : null;
  batch(() => {
    ui.selectedId.value = id;
    ui.playback.value = player.ready ? (autoplay ? 'BUFFERING' : 'READY') : 'CONNECTING';
    updateTrack();
  });
  if (track.unavailable) renderPlaylist();
  persist();
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
  const wasPlaying = playbackRequested;
  state.playlist.splice(index, 1);
  if (ui.selectedId.value === id) {
    const next = state.playlist[Math.min(index, state.playlist.length - 1)];
    if (next) selectTrack(next.id, wasPlaying);
    else { clearTimeout(skipTimer); ui.selectedId.value = null; stopped = true; wantsPlayback = false; playbackRequested = false; ui.playback.value = 'EMPTY'; clearPlayerError(); player.load(null); updateTrack(); }
  }
  renderPlaylist(); persist();
  notify('Track removed.');
}
function navigate(direction) {
  const index = nextTrackIndex(snapshot(), { direction });
  if (index >= 0) selectTrack(state.playlist[index].id, true);
  else notify('No playable tracks are available. Use Retry on an unavailable track.');
}
function retryTrack(id) {
  if (!state.playlist.some(track => track.id === id)) return;
  selectTrack(id, true);
  notify('Retrying the video…');
}
function retryUnavailable() {
  const tracks = state.playlist.filter(track => track.unavailable);
  for (const track of tracks) track.unavailable.checkedAt = 0;
  persist(); renderPlaylist();
  if (!playbackRequested && tracks.length) retryTrack(tracks[0].id);
  else notify('Unavailable tracks will be tried again as the playlist reaches them.');
}
function play() {
  if (!currentTrack()) return;
  if (hasError) { if (currentTrack().unavailable && player.ready) retryTrack(ui.selectedId.value); else retryPlayer(true); return; }
  stopped = false; wantsPlayback = true; playbackRequested = true;
  if (currentTrack().unavailable && player.ready) { retryTrack(ui.selectedId.value); return; }
  if (player.ready) player.play();
  else { player.load(currentTrack(), true); notify('Connecting to YouTube…'); }
}
function pause() { playbackRequested = false; clearTimeout(skipTimer); wantsPlayback = false; if (!player.ready) player.load(currentTrack(), false); player.pause(); }
function stop() { playbackRequested = false; clearTimeout(skipTimer); stopped = true; wantsPlayback = false; player.stop(); if (!player.ready) player.load(currentTrack(), false); ui.playback.value = currentTrack() ? 'STOPPED' : 'EMPTY'; $('#time').textContent = '00:00'; $('#seek').value = 0; }
function setVolume(value) { batch(() => { ui.volume.value = clamp(value, 0, 100); ui.muted.value = false; }); player.volume(ui.volume.value, ui.muted.value); persist(); }
function toggleMute() { ui.muted.value = !ui.muted.value; player.volume(ui.volume.value, ui.muted.value); persist(); }
function togglePanel(key) { ui.visibility[key].value = !ui.visibility[key].value; persist(); }
function retryPlayer(autoplay = true) { clearTimeout(skipTimer); playbackRequested = autoplay; stopped = false; clearPlayerError(); ui.playback.value = 'CONNECTING'; $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTING'; $('#connection-light').classList.remove('connected'); $('#video-placeholder').hidden = false; $('#video-placeholder-note').textContent = 'Reconnecting to YouTube…'; player.initialize(); player.load(currentTrack(), autoplay); }

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
  if (Number.isFinite(progress.volume) && (Math.round(progress.volume) !== Math.round(ui.volume.value) || progress.muted !== ui.muted.value)) {
    batch(() => { ui.volume.value = progress.volume; ui.muted.value = progress.muted; }); persist();
  }

}

function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
function openAdd() { $('#add-error').hidden = true; updateAddForm(); showDialog('add-dialog'); $('#video-url').focus(); }
for (const button of document.querySelectorAll('[data-dismiss]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#open-add').onclick = openAdd; $('#playlist-add').onclick = openAdd;
$('#open-skins').onclick = () => showDialog('skins-dialog'); $('#footer-skins').onclick = () => showDialog('skins-dialog');
$('#open-help').onclick = () => showDialog('help-dialog');
$('#open-account').hidden = !window.yinampDesktop;
let desktopAccount = { status: 'checking', playerStatus: 'checking' };
let accountIssue = '';
function updateAccount(data) {
  desktopAccount = data; renderAccount(data);
  musicLibrary?.accountChanged(data);
  if (data.issue && data.issue !== accountIssue) notify(data.issue, true);
  accountIssue = data.issue || '';
}
async function checkAccount() { try { updateAccount(await window.yinampDesktop.account('status')); } catch { renderAccount({ ...desktopAccount, issue: 'Login status could not be checked. Try again.' }); } }
if (window.yinampDesktop) {
  renderAccount(desktopAccount);
  const unsubscribeAccount = window.yinampDesktop.onPlayer(event => { if (event.type === 'account-state') updateAccount(event.data); });
  window.addEventListener('pagehide', unsubscribeAccount, { once: true });
  void checkAccount();
}
$('#open-account').onclick = () => { renderAccount(desktopAccount); showDialog('account-dialog'); void checkAccount(); };
async function accountAction(action) {
  if (!window.yinampDesktop) return;
  const buttons = [...document.querySelectorAll('.account-actions button')];
  buttons.forEach(button => { button.disabled = true; });
  $('#account-error').hidden = true;
  try {
    const result = await window.yinampDesktop.account(action);
    if (action !== 'diagnostics') $('#account-dialog').close();
    if (action !== 'diagnostics') notify(action === 'refresh' ? result.refreshed ? 'Updating the player session. Press Play when ready.' : 'Add a track to check the player session.' : action === 'sign-out' ? 'Signed out of Yinamp. Your playlists and browser accounts are unchanged.' : result.opened === false ? 'Account window closed. Press Play to resume.' : 'Complete sign-in in the YouTube account window. Close it when done, then press Play.');
  } catch (error) { $('#account-error').textContent = error.message; $('#account-error').hidden = false; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
$('#account-sign-in').onclick = () => accountAction('open');
$('#account-switch').onclick = () => accountAction('switch');
$('#account-sign-out').onclick = () => accountAction('sign-out');
$('#account-refresh').onclick = () => accountAction('refresh');
$('#account-check').onclick = () => void checkAccount();
$('#account-diagnostics').onclick = () => accountAction('diagnostics');
musicLibrary = setupMusicLibrary({ onPlay: item => openOnlinePlaylist(item, true), onSignIn: () => accountAction('library'), onLayout: () => panels.refresh() });
$('#reset-layout').onclick = () => { panels.reset(); notify('Windows arranged.'); };
$('#compact-main').onclick = () => { const body = $('#main-body'); body.hidden = !body.hidden; $('#compact-main').setAttribute('aria-expanded', String(!body.hidden)); panels.refresh(); };
$('#fullscreen').onclick = async () => { if (window.yinampDesktop) { player.fullscreen(); return; } try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#video-viewport').requestFullscreen(); } catch { notify('Use the fullscreen button inside the YouTube video on this browser.'); } };
$('#play').onclick = play; $('#pause').onclick = pause; $('#stop').onclick = stop;
$('#next').onclick = () => navigate(1); $('#previous').onclick = () => navigate(-1);
$('#volume').oninput = event => setVolume(event.target.value);
$('#mute').onclick = toggleMute;
$('#shuffle').onclick = () => { ui.shuffle.value = !ui.shuffle.value; persist(); };
$('#repeat').onclick = () => { ui.repeat.value = { off: 'all', all: 'one', one: 'off' }[ui.repeat.value]; persist(); notify(`Repeat ${ui.repeat.value}.`); };
$('#toggle-eq').onclick = () => togglePanel('eq'); $('#toggle-playlist').onclick = () => togglePanel('playlist');
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => togglePanel(button.dataset.close);
$('#retry-player').onclick = () => retryPlayer(true);
$('#retry-unavailable').onclick = retryUnavailable;
$('#seek').oninput = event => { seeking = true; $('#time').textContent = formatTime(event.target.value); };
$('#seek').onchange = event => { stopped = false; player.seek(Number(event.target.value)); seeking = false; };
$('#seek').addEventListener('pointercancel', () => { seeking = false; });
$('#seek').addEventListener('blur', () => { seeking = false; });

function updateAddForm() {
  let parsed;
  try { parsed = parseYouTubeInput($('#video-url').value); } catch { /* Validate on submission. */ }
  const hasPlaylist = parsed?.type === 'playlist';
  const wholePlaylist = hasPlaylist && (!parsed.video || $('#include-playlist').checked);
  $('#playlist-option').hidden = !hasPlaylist || !parsed.video;
  $('#video-title-field').hidden = wholePlaylist;
  $('#add-submit').textContent = wholePlaylist ? 'OPEN PLAYLIST' : 'ADD VIDEO';
  $('#add-hint').textContent = wholePlaylist ? 'Replace the queue with this playlist. Your current queue stays until it loads.' : 'Add one video or open a YouTube playlist.';
}
function setAddBusy(busy) {
  $('#add-form').setAttribute('aria-busy', String(busy));
  for (const id of ['video-url', 'video-title', 'include-playlist', 'add-submit']) $(`#${id}`).disabled = busy;
  $('#playlist-preview').hidden = !busy;
  $('#add-status').hidden = !busy;
  if (busy) { $('#add-submit').textContent = 'LOADING…'; $('#add-status').textContent = 'Loading the playlist from YouTube…'; }
  else updateAddForm();
}
async function fillTrackTitles(tracks) {
  const remaining = [...tracks];
  const worker = async () => {
    while (remaining.length) {
      const track = remaining.shift();
      try {
        const response = await fetch(`/api/video?id=${encodeURIComponent(track.id)}`);
        if (!response.ok) continue;
        const data = await response.json();
        if (typeof data.title !== 'string' || !state.playlist.includes(track)) continue;
        track.title = data.title;
        renderPlaylist();
        if (ui.selectedId.value === track.id) { ui.trackTitle.value = track.title; $('#track-title').textContent = track.title.toUpperCase(); $('#track-title').title = track.title; }
        persist();
      } catch { /* A title lookup never prevents playback. */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, tracks.length) }, worker));
}
$('#video-url').oninput = () => { $('#include-playlist').checked = true; $('#add-error').hidden = true; updateAddForm(); };
$('#include-playlist').onchange = updateAddForm;
$('#add-dialog').addEventListener('close', () => playlistImport?.abort());
$('#add-dialog').addEventListener('cancel', () => playlistImport?.abort());

async function openOnlinePlaylist(value, autoplay = false, options = {}) {
  const source = window.yinampDesktop?.library
    ? await window.yinampDesktop.library({ action: 'playlist', playlist: { id: value.id ?? value.playlistId, seed: value.seed ?? value.video?.id ?? null, source: value.source ?? 'youtube' } })
    : value.source === 'music' ? await (async () => { const response = await fetch(`/api/playlist?id=${encodeURIComponent(value.id)}&source=music`, { signal: options.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })()
    : await readPlaylistWithFallback(value.id ?? value.playlistId, { container: $('#playlist-preview'), ...options });
  if (options.signal?.aborted) throw new DOMException('Playlist import cancelled', 'AbortError');
  const result = appendPlaylistTracks([], source.ids ?? source.tracks.map(track => track.id));
  if (!result.added.length) throw new Error('No available songs were found. Your previous queue is unchanged.');
  const metadata = new Map((source.tracks ?? []).map(track => [track.id, track]));
  for (const track of result.added) {
    const data = metadata.get(track.id);
    if (typeof data?.title === 'string') track.title = data.title.slice(0, 300);
    if (Number.isFinite(data?.duration)) track.duration = clamp(data.duration, 0, 604800);
  }
  stop(); state.playlist = result.added; ui.selectedId.value = result.added[0].id;
  renderPlaylist(); selectTrack(ui.selectedId.value, autoplay); persist();
  void fillTrackTitles(result.added.filter(track => !metadata.has(track.id)));
  return { partial: source.partial || result.overflow > 0, count: result.added.length };
}

$('#add-form').onsubmit = async event => {
  event.preventDefault();
  if (playlistImport) return;
  let parsed;
  try { parsed = parseYouTubeInput($('#video-url').value); }
  catch (error) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; return; }
  const wholePlaylist = parsed.type === 'playlist' && (!parsed.video || $('#include-playlist').checked);
  if (wholePlaylist) {
    const controller = new AbortController();
    playlistImport = controller;
    $('#add-error').hidden = true;
    setAddBusy(true);
    try {
      const result = await openOnlinePlaylist(parsed, false, {
        signal: controller.signal,
        onFallback: () => { $('#playlist-preview').hidden = true; $('#add-status').textContent = 'Reading the public playlist listing…'; },
      });
      if (controller.signal.aborted || !$('#add-dialog').open) return;
      $('#add-dialog').close(); $('#add-form').reset();
      notify(`Opened ${result.count} songs.${result.partial ? ' Loaded the available portion of this playlist.' : ''}`);
    } catch (error) {
      if (error.name !== 'AbortError' && $('#add-dialog').open) { $('#add-error').textContent = error.message; $('#add-error').hidden = false; }
    } finally {
      if (playlistImport === controller) { playlistImport = null; setAddBusy(false); }
    }
    return;
  }
  if (parsed.type === 'playlist') parsed = parsed.video;
  else { const { id, start } = parsed; parsed = { id, start }; }
  if (state.playlist.some(track => track.id === parsed.id)) { selectTrack(parsed.id); $('#add-dialog').close(); notify('That video is already in your playlist. Selected it for you.'); return; }
  if (state.playlist.length >= 500) { $('#add-error').textContent = 'Your playlist is full (500 tracks). Remove a track first.'; $('#add-error').hidden = false; return; }
  const title = $('#video-title').value.trim();
  const track = { ...parsed, title: title || `YouTube — ${parsed.id}`, duration: 0 };
  state.playlist.push(track);
  const first = !ui.selectedId.value;
  if (first) { renderPlaylist(); selectTrack(track.id); }
  else { renderPlaylist(); persist(); }
  $('#add-dialog').close(); $('#add-form').reset(); notify('Added to your playlist.');
  if (!title) void fillTrackTitles([track]);
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
    const imported = initialState({ version: 2, playlist: data.tracks });
    resetEmbedFailures(imported.playlist);
    stop(); state.playlist = imported.playlist; ui.selectedId.value = imported.selectedId;
    renderPlaylist();
    if (currentTrack()) selectTrack(ui.selectedId.value);
    else { player.load(null); ui.playback.value = 'EMPTY'; updateTrack(); renderPlaylist(); persist(); }
    notify(`Loaded ${state.playlist.length} tracks.`);
  } catch (error) { notify(error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message, true); }
};

document.addEventListener('keydown', event => {
  if (event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') || event.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;
  const actions = { ' ': () => ui.playback.value === 'PLAYING' || wantsPlayback ? pause() : play(), ArrowLeft: () => player.seek(Math.max(0, player.progress().current - 5)), ArrowRight: () => player.seek(player.progress().current + 5), ArrowUp: () => setVolume(ui.volume.value + 5), ArrowDown: () => setVolume(ui.volume.value - 5), m: toggleMute, n: () => navigate(1), p: () => navigate(-1) };
  const action = actions[event.key] ?? actions[event.key.toLowerCase()];
  if (action) { event.preventDefault(); action(); }
});

renderSkin(); renderPlaylist(); updateTrack();
bindPlayerUI(ui, { onLayout: () => panels.refresh(), onInactive: () => visualizer.update() });
player.load(currentTrack(), false);
player.initialize();
setInterval(updateProgress, 350);
if (!storageAvailable) notify('Browser storage is unavailable. Use SAVE to export your playlist.', true);
window.addEventListener('pagehide', persistence.flush);
window.addEventListener('beforeunload', persistence.flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistence.flush(); });
