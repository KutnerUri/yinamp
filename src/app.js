import { icon } from './icons.js';
import { createLoader } from './loading-ui.js';
import { cleanVersions, playbackTrack, versionMode, recordingControl } from './track-versions.js';
import { normalizePlaylistIdentity, STORAGE_KEY, SKINS, TRACK_ERROR_CODES, canAttemptTrack, initialState, validateSkin, parseYouTubeInput, appendPlaylistTracks, nextTrackIndex, formatTime, clamp, playlistDisplay, removeFromPlaylist, restoreToPlaylist, expireGhost } from './core.js';
import { YouTubePlayer } from './youtube.js';
import { setupVisualizer } from './visualizer.js';
import { setupEqualizer } from './equalizer.js';
import { NativePlayer } from './native-player.js';
import { setupPanels } from './panels.js';
import { readPlaylistWithFallback } from './playlist-import.js';
import { renderAccount } from './account-ui.js';
import { setupMusicLibrary } from './library-ui.js';
import { batch, effect } from '@preact/signals-core';
import { createPlayerUI, savedPlayerState, bindPlayerUI, createVolumeSync } from './player-ui.js';
import { setupPlaylistNavigation } from './playlist-navigation.js';
import { createDebouncedSave } from './persistence.js';

const $ = selector => document.querySelector(selector);
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = icon(node.dataset.icon);
let stored;
let storageAvailable = true;
try { stored = window.yinampDesktop ? await window.yinampDesktop.readState() : JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { storageAvailable = false; }
const state = initialState(stored);
function resetEmbedFailures(tracks) { if (window.yinampDesktop) for (const track of tracks) if ([101, 150].includes(track.unavailable?.code)) delete track.unavailable; }
resetEmbedFailures(state.playlist);
const ui = createPlayerUI(state);
const refreshPlaylistNavigation = setupPlaylistNavigation($('#playlist'), $('#playlist-current'));
const snapshot = () => savedPlayerState(state, ui);
let seeking = false;
let adjustingVolume = false;
const volumeSync = createVolumeSync();
let stopped = false;
let hasError = false;
let wantsPlayback = false;
let noticeTimeout;
let playlistImport;
// Playlist feedback: a removed track's undo slot, a flashing row, and a note on the track count.
// Fade timings follow the golden ratio: φ⁻² s in, φ⁻¹ s out.
const ROW_FLASH_MS = 1600, UNDO_MS = 5000, SUMMARY_NOTE_MS = 6000, GHOST_IN_MS = 382, GHOST_OUT_MS = 618, ENTRANCE_ROWS = 10, ENTRANCE_STEP_MS = 38;
let removedTracks = [], ghostsFor = null, flashingRow = null, summaryNote = null, queueEntrance = null, clearedQueue = null, loadingPlaylist = null, streamingList = null;
let playbackRequested = false;
let playIntentPending = false;
let skipTimer;
let retryingId = null;
let musicLibrary;
let playingId = null;
let versionRequest = 0;
let versionChecking = false;
const versionErrors = new Map();
let switchTimer;
let switchFallback = null;
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

const visualizer = setupVisualizer($('#visualizer'), { simulated: !window.yinampDesktop });
$('#visualizer').setAttribute('aria-label', window.yinampDesktop ? 'Live music spectrum' : 'Simulated audio spectrum — decorative animation');
if (!window.yinampDesktop) {
  $('#visualizer').title = 'Simulated spectrum — decorative animation';
  effect(() => visualizer.setPlaying(ui.playback.value === 'PLAYING'));
}
const Player = window.yinampDesktop ? NativePlayer : YouTubePlayer;
let equalizerControls;
const player = new Player({
  onEqualizerAvailability: available => equalizerControls?.setAvailable(available),
  onSpectrum: data => visualizer.update(data),
  onReconnecting() {
    ui.playback.value = 'CONNECTING';
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> RECONNECTING';
    $('#video-placeholder-note').textContent = 'Reconnecting to YouTube…';
  },
  onReady() {
    clearPlayerError();
    player.volume(ui.volume.value, ui.muted.value);
    player.equalizer?.(state.equalizer);
    $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTED';
    $('#connection-light').classList.add('connected');
    $('#video-placeholder').hidden = Boolean(currentTrack());
    if (!currentTrack()) $('#video-placeholder-note').textContent = 'Choose a playlist from your library or add a song.';
    ui.playback.value = currentTrack() ? 'READY' : 'EMPTY';
    renderVersions();
    queueMicrotask(() => { if (state.playbackMode) switchRecording(state.playbackMode, false); });
  },
  onState(code) {
    if (hasError) return;
    if (switchFallback) {
      if ([0, -1, 3].includes(code) || switchFallback.autoplay && [2, 5].includes(code) || !switchFallback.autoplay && code === 1) return;
      if ([1, 2, 5].includes(code)) {
        clearTimeout(switchTimer); switchFallback = null; renderVersions();
        queueMicrotask(() => {
          if (!versionErrors.has(currentTrack()?.id)) switchRecording(preferredMode(), false);
        });
      }
    }
    if (playIntentPending && [2, 5].includes(code)) { ui.playback.value = 'BUFFERING'; return; }
    if (code === 1) playIntentPending = false;
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
    renderVersions();
  },
  onError(message, { code, unchanged } = {}) {
    if (switchFallback && switchFallback.trackId === currentTrack()?.id) {
      const fallback = switchFallback;
      clearTimeout(switchTimer); switchFallback = null;
      versionErrors.set(fallback.trackId, { kind: 'switch', mode: fallback.mode, message });
      playingId = fallback.id;
      playbackRequested = fallback.autoplay; wantsPlayback = fallback.autoplay; playIntentPending = fallback.autoplay;
      if (!unchanged && !fallback.recovering) {
        switchFallback = { ...fallback, recovering: true };
        switchTimer = setTimeout(() => { switchFallback = null; renderVersions(); }, 15000);
        player.switchRecording({ ...currentTrack(), id: fallback.id, start: fallback.start, mode: versionMode(currentTrack(), fallback.id) }, fallback.autoplay);
      }
      ui.playback.value = fallback.autoplay ? (unchanged ? 'PLAYING' : 'BUFFERING') : 'PAUSED';
      $('#youtube-link').href = `https://www.youtube.com/watch?v=${playingId}`;
      renderVersions();
      notify('That recording could not play. Kept your preference and the matched versions.', true);
      return;
    }
    playIntentPending = false;
    visualizer.update();
    const track = currentTrack();
    const continueQueue = playbackRequested;
    clearTimeout(skipTimer);
    retryingId = null;
    hasError = true;
    wantsPlayback = false;
    ui.playback.value = 'UNAVAILABLE';
    renderVersions();
    $('#player-error-message').textContent = message;
    $('#player-error').hidden = false;
    $('#video-placeholder').hidden = true;
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
          if (next >= 0) selectTrack(state.playlist[next].id, true);
          else {
            playbackRequested = false; stopped = true; player.pause();
            ui.playback.value = state.playlist.some(value => canAttemptTrack(value)) ? 'QUEUE FINISHED' : 'NO PLAYABLE TRACKS';
            $('#player-error-message').textContent = `${message} No playable tracks remain in this pass. Use a track’s Retry button to try again.`;
          }
        }, 450);
      }
    } else { playbackRequested = false; }
  },
  onAutoplayBlocked() {
    playIntentPending = false;
    ui.playback.value = 'PRESS PLAY';
    renderVersions();
    wantsPlayback = false;
    playbackRequested = false;
    notify('Your browser paused autoplay. Press play in the video window to start.');
  },
});
equalizerControls = setupEqualizer({ state, player, persist });

const panels = setupPanels(state, persist);

function renderSkin() {
  for (const [key, value] of Object.entries(state.skin.colors)) document.documentElement.style.setProperty(`--${key}`, value);
  $('meta[name="theme-color"]').content = state.skin.colors.desktop;
  $('#skin-name').textContent = `${state.skin.name.toUpperCase()} SKIN`;
  $('#custom-skin-name').value = state.skin.name;
  for (const input of document.querySelectorAll('[data-color]')) input.value = state.skin.colors[input.dataset.color];
  for (const button of document.querySelectorAll('[data-skin]')) button.setAttribute('aria-pressed', String(JSON.stringify(SKINS[button.dataset.skin].colors) === JSON.stringify(state.skin.colors)));
}
function renderTrackMetadata(track, pending = false) {
  for (const field of ['artist', 'album']) {
    const element = $(`#track-${field}`);
    const loading = pending && !track?.[field];
    element.textContent = loading ? '---' : track?.[field] ?? '';
    element.classList.toggle('metadata-pending', loading);
    element.setAttribute('aria-busy', String(loading));
    element.title = track?.[field] ?? '';
  }
}
function updateTrack() {
  const track = currentTrack();
  ui.trackTitle.value = track?.title ?? '';
  $('#track-title').textContent = track?.title.toUpperCase() ?? 'YOUR PLAYLIST STARTS HERE';
  $('#track-title').title = track?.title ?? '';
  renderTrackMetadata(track);
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
function preferredMode() {
  return state.playbackMode ?? versionMode(currentTrack(), playingId) ?? 'song';
}
function renderVersions() {
  const track = currentTrack();
  const control = recordingControl(track, preferredMode(), {
    checking: versionChecking, switching: Boolean(switchFallback),
    runningVideo: versionMode(track, playingId) === 'video' && ui.playback.value === 'PLAYING' && !switchFallback,
  });
  const button = $('#version-video');
  button.disabled = control.disabled;
  button.setAttribute('aria-pressed', String(control.pressed));
  button.setAttribute('aria-busy', String(control.busy));
  const title = control.title;
  button.setAttribute('aria-label', title);
  button.title = title;
  button.dataset.active = String(control.active);
}
function loadRecording(track, autoplay = false, start) {
  clearTimeout(switchTimer); switchFallback = null;
  const recording = playbackTrack(track, state.playbackMode, start);
  playingId = recording?.id ?? null;
  if (recording) recording.mode = versionMode(track, playingId) ?? undefined;
  player.load(recording, autoplay);
  renderVersions();
  if (track) $('#youtube-link').href = `https://www.youtube.com/watch?v=${playingId}`;
}
function switchRecording(mode, remember = true) {
  const track = currentTrack();
  const target = track?.versions?.[mode];
  if (remember) { state.playbackMode = mode; persist(); }
  if (!track || switchFallback) { renderVersions(); return; }
  if (!target || !player.ready || target.id === playingId) { renderVersions(); return; }
  const autoplay = playbackRequested;
  const retry = versionErrors.get(track.id)?.kind === 'switch';
  const current = stopped ? 0 : player.progress().current;
  const start = target.duration > 0 ? Math.min(current, Math.max(0, target.duration - 1)) : current;
  clearTimeout(skipTimer); clearPlayerError();
  versionErrors.delete(track.id);
  switchFallback = { id: playingId, start: current, autoplay, trackId: track.id, mode };
  playingId = target.id;
  stopped = false; wantsPlayback = autoplay; playIntentPending = autoplay;
  ui.playback.value = autoplay ? 'BUFFERING' : 'READY';
  renderVersions();
  $('#youtube-link').href = `https://www.youtube.com/watch?v=${playingId}`;
  switchTimer = setTimeout(() => {
    if (switchFallback?.trackId === track.id) player.handlers.onError('The recording switch timed out.');
  }, 15000);
  player.switchRecording({ ...track, id: target.id, start, mode, retry }, autoplay);
}
async function resolveVersions(force = false) {
  const track = currentTrack();
  const request = ++versionRequest;
  versionChecking = false;
  if (!track) { renderVersions(); return; }
  if (!force && (track.versionsChecked || track.versions?.song && track.versions?.video)) {
    renderVersions();
    if (state.playbackMode && !versionErrors.has(track.id)) switchRecording(state.playbackMode, false);
    return;
  }
  versionErrors.delete(track.id); versionChecking = true; renderVersions();
  renderTrackMetadata(track, true);
  try {
    const result = window.yinampDesktop
      ? await window.yinampDesktop.library({ action: 'versions', id: track.id })
      : await (async () => {
        const response = await fetch(`/api/track-versions?id=${encodeURIComponent(track.id)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        return result;
      })();
    if (request !== versionRequest || currentTrack() !== track) return;
    track.versions = cleanVersions({ ...track.versions, ...result.versions });
    for (const field of ['artist', 'album']) if (!track[field] && typeof result[field] === 'string' && result[field].trim()) track[field] = result[field].trim().slice(0, 300);
    renderTrackMetadata(track);
    track.versionsChecked = true;
    state.playbackMode ??= versionMode(track, playingId) ?? 'song';
    versionChecking = false; persist(); renderVersions();
    switchRecording(state.playbackMode, false);
  } catch (error) {
    if (request !== versionRequest || currentTrack() !== track) return;
    renderTrackMetadata(track);
    versionChecking = false; versionErrors.set(track.id, { kind: 'lookup', message: error.message }); renderVersions();
  }
}
$('#version-video').onclick = () => {
  switchRecording(preferredMode() === 'video' ? 'song' : 'video');
  if (versionErrors.get(currentTrack()?.id)?.kind === 'lookup' && !versionChecking) void resolveVersions(true);
};

function renderPlaylist() {
  if (!state.playlist.length) state.activePlaylist = null;
  // While a playlist loads, the header already shows it (name and cover as soon as they are known).
  const loading = loadingPlaylist, identity = loading ?? state.activePlaylist;
  const header = $('#active-playlist');
  header.classList.toggle('pending-name', Boolean(loading && !loading.title));
  header.classList.toggle('pending-cover', Boolean(loading && !loading.thumbnail));
  $('#active-playlist-name').textContent = identity ? identity.title : state.playlist.length ? 'Open a playlist to identify this queue.' : '';
  header.hidden = !loading && !state.playlist.length;
  header.title = identity?.title ?? '';
  const cover = $('#active-playlist-cover');
  if (cover.getAttribute('src') !== (identity?.thumbnail || null)) {
    cover.hidden = !identity?.thumbnail;
    if (identity?.thumbnail) cover.src = identity.thumbnail;
    else cover.removeAttribute('src');
  }
  cover.onerror = () => { cover.hidden = true; };
  musicLibrary?.setActivePlaylist(state.activePlaylist);
  musicLibrary?.queueChanged();
  const list = $('#playlist');
  const focused = document.activeElement;
  const focusedId = focused?.closest('[data-track-id]')?.dataset.trackId;
  const focusedAction = focused?.dataset.action;
  // Focus on a ghost's UNDO, or on the × that just removed a track, moves to that ghost's UNDO.
  const focusedGhost = focused?.closest?.('.playlist-removed')?.dataset.ghostId ?? (focusedAction === 'remove' && removedTracks.some(ghost => ghost.track.id === focusedId) ? focusedId : null);
  // A replaced queue (opened playlist, loaded file) has no slots to undo into.
  if (ghostsFor !== state.playlist) { for (const ghost of removedTracks) clearTimeout(ghost.timer); removedTracks = []; ghostsFor = state.playlist; }
  const now = performance.now();
  const entrance = queueEntrance && now - queueEntrance < ENTRANCE_ROWS * ENTRANCE_STEP_MS + GHOST_IN_MS ? queueEntrance : null;
  if (loading) {
    list.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
      const row = document.createElement('li'); row.className = 'playlist-skeleton'; row.setAttribute('aria-hidden', 'true');
      const numberBar = document.createElement('span'), titleBar = document.createElement('span'), durationBar = document.createElement('span');
      numberBar.className = 'skeleton-number'; titleBar.className = 'skeleton-name'; durationBar.className = 'skeleton-duration';
      // Vary the title widths between φ⁻¹ and 1 so the rows read as text, not a block.
      titleBar.style.width = `${Math.round(100 * (0.618 + 0.382 * ((index * 0.618) % 1)))}%`;
      row.append(numberBar, titleBar, durationBar); return row;
    }));
    list.setAttribute('aria-busy', 'true');
    $('#playlist-summary').textContent = 'LOADING…'; $('#playlist-summary').title = '';
    $('#retry-unavailable').hidden = true; $('#clear-playlist').hidden = true;
    refreshPlaylistNavigation();
    return;
  }
  list.removeAttribute('aria-busy');
  const display = playlistDisplay(state.playlist, removedTracks);
  list.replaceChildren();
  let number = 0;
  display.forEach(({ track, ghost }, position) => {
    if (ghost) { list.append(removedRow(ghost, now)); return; }
    const index = number++;
    const row = document.createElement('li');
    if (entrance && position < ENTRANCE_ROWS) { row.classList.add('entering'); row.style.animationDelay = `${position * ENTRANCE_STEP_MS - (now - entrance)}ms`; }
    row.dataset.trackId = track.id;
    if (flashingRow?.id === track.id) {
      const elapsed = performance.now() - flashingRow.start;
      if (elapsed < ROW_FLASH_MS) { row.classList.remove('entering'); row.classList.add('flash'); row.style.animationDelay = `${-elapsed}ms`; }
    }
    row.classList.toggle('current', track.id === ui.selectedId.value);
    row.classList.toggle('unavailable', Boolean(track.unavailable));
    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'track-select';
    select.dataset.action = 'select';
    select.setAttribute('aria-pressed', String(track.id === ui.selectedId.value));
    select.setAttribute('aria-label', `Select ${track.title}`);
    const numberLabel = document.createElement('span'); numberLabel.className = 'track-number'; numberLabel.textContent = String(index + 1).padStart(2, '0') + '.';
    const copy = document.createElement('span'); copy.className = 'track-copy';
    const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.title; name.title = track.title; copy.append(name);
    if (track.unavailable) {
      const status = document.createElement('span'); status.className = 'track-availability'; status.textContent = retryingId === track.id ? '↻' : '!'; status.setAttribute('aria-label', retryingId === track.id ? 'Retrying' : 'Unavailable'); status.title = track.unavailable.message; copy.append(status);
    }
    const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = track.duration ? formatTime(track.duration) : '--:--';
    select.append(numberLabel, copy, duration);
    select.addEventListener('click', () => selectTrack(track.id, ui.playback.value === 'PLAYING'));
    select.addEventListener('dblclick', () => selectTrack(track.id, true));
    const tools = document.createElement('div'); tools.className = 'track-tools';
    if (track.unavailable) {
      const retry = document.createElement('button'); retry.type = 'button'; retry.innerHTML = icon('refresh'); retry.dataset.action = 'retry'; retry.setAttribute('aria-label', `Retry ${track.title}`); retry.title = 'Retry this video'; retry.onclick = () => retryTrack(track.id);
      const open = document.createElement('a'); open.innerHTML = icon('external'); open.href = `https://www.youtube.com/watch?v=${track.id}`; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.setAttribute('aria-label', `Open ${track.title} on YouTube`); open.title = 'Open on YouTube';
      tools.append(retry, open);
    }
    for (const [action, label, symbol] of [['up', 'Move up', 'up'], ['down', 'Move down', 'down'], ['remove', 'Remove', 'close']]) {
      const button = document.createElement('button'); button.type = 'button'; button.innerHTML = icon(symbol); button.dataset.action = action;
      button.setAttribute('aria-label', `${label} ${track.title}`);
      button.disabled = (action === 'up' && index === 0) || (action === 'down' && index === state.playlist.length - 1);
      button.addEventListener('click', () => action === 'remove' ? removeTrack(track.id) : moveTrack(track.id, action === 'up' ? -1 : 1));
      tools.append(button);
    }
    row.append(select, tools); list.append(row);
  });
  // Anything queued after a clear replaces it, so its undo no longer applies.
  if (clearedQueue && state.playlist.length) { clearTimeout(clearedQueue.timer); clearedQueue = null; }
  if (!display.length) {
    const empty = document.createElement('li'); empty.className = 'playlist-empty';
    if (clearedQueue) {
      const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'removed-undo'; undo.textContent = 'UNDO';
      undo.setAttribute('aria-label', `Undo clearing ${clearedQueue.playlist.length} tracks`); undo.onclick = undoClear;
      empty.append(document.createTextNode('Queue cleared.'), undo);
    } else empty.textContent = 'Nothing queued. Add your first video.';
    list.append(empty);
  }
  const total = state.playlist.reduce((sum, track) => sum + track.duration, 0);
  const unavailableCount = state.playlist.filter(track => track.unavailable).length;
  $('#playlist-summary').textContent = `${state.playlist.length} ${state.playlist.length === 1 ? 'TRACK' : 'TRACKS'}${unavailableCount ? ` · ${unavailableCount} UNAVAILABLE` : total ? ` · ${formatTime(total)}` : ''}${streamingList && streamingList === state.playlist ? ' · LOADING' : ''}${summaryNote ? ` · ${summaryNote.text}` : ''}`;
  $('#playlist-summary').title = summaryNote?.title ?? '';
  $('#retry-unavailable').hidden = !unavailableCount;
  $('#clear-playlist').hidden = !state.playlist.length;
  if (focusedGhost) list.querySelector(`.playlist-removed[data-ghost-id="${CSS.escape(focusedGhost)}"] button`)?.focus({ preventScroll: true });
  else if (focusedId && focusedAction) list.querySelector(`[data-track-id="${focusedId}"] [data-action="${focusedAction}"]`)?.focus({ preventScroll: true });
  refreshPlaylistNavigation();
}
// A removed track keeps its row, struck through, with UNDO where × was, until it fades out.
function removedRow(ghost, now) {
  const { track } = ghost;
  const row = document.createElement('li'); row.className = 'playlist-removed'; row.dataset.ghostId = track.id;
  if (ghost.leaving) { row.classList.add('leaving'); row.style.animationDelay = `${-(now - ghost.leaving)}ms`; }
  else if (now - ghost.start < GHOST_IN_MS) { row.classList.add('arriving'); row.style.setProperty('--ghost-delay', `${-(now - ghost.start)}ms`); }
  const body = document.createElement('span'); body.className = 'track-select';
  const number = document.createElement('span'); number.className = 'track-number'; number.textContent = '–';
  const copy = document.createElement('span'); copy.className = 'track-copy';
  const name = document.createElement('span'); name.className = 'track-name'; name.textContent = track.title; name.title = `Removed: ${track.title}`; copy.append(name);
  const duration = document.createElement('span'); duration.className = 'track-duration'; duration.textContent = track.duration ? formatTime(track.duration) : '--:--';
  body.append(number, copy, duration);
  const tools = document.createElement('div'); tools.className = 'track-tools';
  const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'removed-undo'; undo.textContent = 'UNDO';
  undo.setAttribute('aria-label', `Undo removing ${track.title}`); undo.onclick = () => undoRemove(ghost);
  tools.append(undo); row.append(body, tools);
  return row;
}
// Show where an added or existing track sits: scroll it into the list's view and flash it.
function flashRow(id) {
  const flash = flashingRow = { id, start: performance.now() };
  const list = $('#playlist'), row = list.querySelector(`[data-track-id="${CSS.escape(id)}"]`);
  for (const other of list.querySelectorAll('li.flash')) if (other !== row) other.classList.remove('flash');
  if (!row) return;
  const listRect = list.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
  const top = rowRect.top - listRect.top - list.clientTop + list.scrollTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + rowRect.height > list.scrollTop + list.clientHeight) list.scrollTop = top + rowRect.height - list.clientHeight;
  row.classList.remove('flash'); row.style.animationDelay = ''; void row.offsetWidth; row.classList.add('flash');
  // Reduced motion shows a static outline instead of the fade, so clear it explicitly.
  setTimeout(() => { if (flashingRow === flash) $(`#playlist [data-track-id="${CSS.escape(id)}"]`)?.classList.remove('flash'); }, ROW_FLASH_MS);
}
// Blink the track count after the whole queue changes; a note (e.g. PARTIAL) stays a little longer.
function flashSummary(note = null) {
  flashingRow = null;
  clearTimeout(summaryNote?.timer);
  summaryNote = note && { ...note, timer: setTimeout(() => { summaryNote = null; renderPlaylist(); }, SUMMARY_NOTE_MS) };
  renderPlaylist();
  const summary = $('#playlist-summary');
  summary.classList.remove('flash'); void summary.offsetWidth; summary.classList.add('flash');
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
  playIntentPending = autoplay;
  if (retryingId) {
    const status = $(`#playlist [data-track-id="${retryingId}"] .track-availability`);
    if (status) { status.textContent = '!'; status.setAttribute('aria-label', 'Unavailable'); }
  }
  retryingId = track.unavailable && autoplay ? id : null;
  batch(() => {
    ui.selectedId.value = id;
    ui.playback.value = player.ready ? (autoplay ? 'BUFFERING' : 'READY') : 'CONNECTING';
    updateTrack();
  });
  if (track.unavailable) renderPlaylist();
  persist();
  loadRecording(track, autoplay);
  void resolveVersions();
}
function moveTrack(id, direction) {
  const index = state.playlist.findIndex(t => t.id === id);
  const destination = index + direction;
  if (destination < 0 || destination >= state.playlist.length) return;
  [state.playlist[index], state.playlist[destination]] = [state.playlist[destination], state.playlist[index]];
  renderPlaylist(); persist();
}
function removeTrack(id) {
  const wasPlaying = playbackRequested;
  const removed = removeFromPlaylist(state.playlist, id, removedTracks);
  if (!removed) return;
  const { index } = removed;
  if (ui.selectedId.value === id) {
    const next = state.playlist[Math.min(index, state.playlist.length - 1)];
    if (next) selectTrack(next.id, wasPlaying);
    else resetToEmpty();
  }
  const ghost = { ...removed, start: performance.now(), leaving: 0 };
  ghost.timer = setTimeout(() => leaveGhost(ghost), UNDO_MS);
  removedTracks.push(ghost);
  renderPlaylist(); persist();
}
function leaveGhost(ghost) {
  ghost.leaving = performance.now();
  renderPlaylist();
  ghost.timer = setTimeout(() => {
    // If its UNDO had focus, hand focus to whatever now sits in that spot.
    const list = $('#playlist'), row = list.querySelector(`.playlist-removed[data-ghost-id="${CSS.escape(ghost.track.id)}"]`);
    const position = row?.contains(document.activeElement) ? [...list.children].indexOf(row) : -1;
    expireGhost(removedTracks, ghost); renderPlaylist();
    if (position >= 0) (list.children[Math.min(position, list.children.length - 1)]?.querySelector('button') ?? $('#playlist-add')).focus({ preventScroll: true });
  }, GHOST_OUT_MS);
}
function resetToEmpty() {
  clearTimeout(skipTimer); ui.selectedId.value = null; stopped = true; wantsPlayback = false; playbackRequested = false;
  ui.playback.value = 'EMPTY'; clearPlayerError(); loadRecording(null); void resolveVersions(); updateTrack();
}
// Clearing empties the queue at once; the empty list offers UNDO for a few seconds.
function clearPlaylist() {
  if (!state.playlist.length) return;
  const hadFocus = document.activeElement === $('#clear-playlist');
  clearTimeout(clearedQueue?.timer);
  clearedQueue = { playlist: state.playlist, selectedId: ui.selectedId.value, activePlaylist: state.activePlaylist, timer: setTimeout(() => { clearedQueue = null; renderPlaylist(); }, UNDO_MS) };
  stop(); state.playlist = []; state.activePlaylist = null; resetToEmpty();
  renderPlaylist(); persist();
  if (hadFocus) $('#playlist .playlist-empty button')?.focus({ preventScroll: true });
}
function undoClear() {
  const cleared = clearedQueue;
  if (!cleared || state.playlist.length) return;
  clearTimeout(cleared.timer); clearedQueue = null;
  state.playlist = cleared.playlist; state.activePlaylist = cleared.activePlaylist;
  ui.selectedId.value = cleared.selectedId;
  flashingRow = null; queueEntrance = performance.now(); renderPlaylist();
  if (currentTrack()) selectTrack(ui.selectedId.value);
  persist();
  $('#clear-playlist').focus({ preventScroll: true });
}
function undoRemove(ghost) {
  clearTimeout(ghost.timer);
  const restored = ghostsFor === state.playlist && restoreToPlaylist(state.playlist, removedTracks, ghost) >= 0;
  if (!restored) expireGhost(removedTracks, ghost);
  renderPlaylist();
  if (!restored) return;
  if (!ui.selectedId.value) selectTrack(ghost.track.id);
  persist();
  flashRow(ghost.track.id);
  $(`#playlist [data-track-id="${CSS.escape(ghost.track.id)}"] .track-select`)?.focus({ preventScroll: true });
}
function navigate(direction) {
  const index = nextTrackIndex(snapshot(), { direction });
  if (index >= 0) selectTrack(state.playlist[index].id, true);
}
function retryTrack(id) {
  if (!state.playlist.some(track => track.id === id)) return;
  selectTrack(id, true);
}
function retryUnavailable() {
  const tracks = state.playlist.filter(track => track.unavailable);
  for (const track of tracks) track.unavailable.checkedAt = 0;
  persist(); renderPlaylist();
  if (!playbackRequested && tracks.length) retryTrack(tracks[0].id);
}
function play() {
  playIntentPending = true;
  if (switchFallback) switchFallback.autoplay = true;
  if (!currentTrack()) return;
  if (hasError) { if (currentTrack().unavailable && player.ready) retryTrack(ui.selectedId.value); else retryPlayer(true); return; }
  stopped = false; wantsPlayback = true; playbackRequested = true;
  if (currentTrack().unavailable && player.ready) { retryTrack(ui.selectedId.value); return; }
  if (player.ready) player.play();
  else loadRecording(currentTrack(), true);
}
function pause() { playIntentPending = false; if (switchFallback) switchFallback.autoplay = false; playbackRequested = false; clearTimeout(skipTimer); wantsPlayback = false; if (!player.ready) loadRecording(currentTrack(), false); player.pause(); }
function stop() { playIntentPending = false; if (switchFallback) switchFallback.autoplay = false; playbackRequested = false; clearTimeout(skipTimer); stopped = true; wantsPlayback = false; player.stop(); if (!player.ready) loadRecording(currentTrack(), false); ui.playback.value = currentTrack() ? 'STOPPED' : 'EMPTY'; $('#time').textContent = '00:00'; $('#seek').value = 0; }
function setVolume(value) { batch(() => { ui.volume.value = clamp(value, 0, 100); ui.muted.value = false; }); volumeSync.request(ui.volume.value, ui.muted.value); player.volume(ui.volume.value, ui.muted.value); persist(); }
function toggleMute() { ui.muted.value = !ui.muted.value; volumeSync.request(ui.volume.value, ui.muted.value); player.volume(ui.volume.value, ui.muted.value); persist(); }
function togglePanel(key) { ui.visibility[key].value = !ui.visibility[key].value; persist(); }
function retryPlayer(autoplay = true) { playIntentPending = autoplay; clearTimeout(skipTimer); playbackRequested = autoplay; stopped = false; clearPlayerError(); ui.playback.value = 'CONNECTING'; $('#connection-light').innerHTML = '<span class="connection-dot"></span> CONNECTING'; $('#connection-light').classList.remove('connected'); $('#video-placeholder').hidden = false; $('#video-placeholder-note').textContent = 'Reconnecting to YouTube…'; player.initialize(); loadRecording(currentTrack(), autoplay); }

function updateProgress() {
  if (!player.ready || hasError || !currentTrack()) return;
  const progress = player.progress();
  const track = currentTrack();
  const mode = versionMode(track, playingId);
  if (progress.duration > 0) {
    const duration = Math.round(progress.duration);
    if (mode && Math.abs(track.versions[mode].duration - duration) > 1) {
      track.versions[mode].duration = duration; persist();
    }
    if (playingId === track.id && Math.abs(track.duration - duration) > 1) {
      track.duration = duration; renderPlaylist(); persist();
    }
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
  if (!adjustingVolume && volumeSync.accepts(progress) && (Math.round(progress.volume) !== Math.round(ui.volume.value) || progress.muted !== ui.muted.value)) {
    batch(() => { ui.volume.value = progress.volume; ui.muted.value = progress.muted; }); persist();
  }

}

function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showDialog(id) { const dialog = $(`#${id}`); if (!dialog.open) dialog.showModal(); }
for (const button of document.querySelectorAll('[data-dismiss]')) button.addEventListener('click', () => button.closest('dialog').close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); } });
$('#open-add').onclick = openAdd; $('#playlist-add').onclick = openAdd;
$('#open-skins').onclick = () => showDialog('skins-dialog');
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
  let mismatchTimer;
  const unsubscribeAccount = window.yinampDesktop.onPlayer(event => {
    if (event.type === 'search-mismatch') { clearTimeout(mismatchTimer); $('#search-mismatch').hidden = false; mismatchTimer = setTimeout(() => { $('#search-mismatch').hidden = true; }, 5000); }
    if (event.type === 'account-state') updateAccount(event.data); });
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
    if (action !== 'diagnostics') notify(action === 'refresh' ? result.refreshed ? 'Updating the player session. Press Play when ready.' : 'Add a track to check the player session.' : action === 'sign-out' ? 'Signed out of Yinamp. Your playlists and browser accounts are unchanged.' : result.opened === false ? 'Account window closed. Press Play to resume.' : action === 'switch' ? 'Choose your channel in the YouTube window. Yinamp will update automatically.' : 'Complete sign-in in the YouTube account window. Close it when done, then press Play.');
  } catch (error) { $('#account-error').textContent = error.message; $('#account-error').hidden = false; }
  finally { buttons.forEach(button => { button.disabled = false; }); }
}
$('#account-sign-in').onclick = () => accountAction('open');
$('#account-switch').onclick = () => accountAction('switch');
$('#account-sign-out').onclick = () => accountAction('sign-out');
$('#account-refresh').onclick = () => accountAction('refresh');
$('#account-check').onclick = () => void checkAccount();
$('#account-diagnostics').onclick = () => accountAction('diagnostics');
musicLibrary = setupMusicLibrary({ pinnedSearches: state.pinnedSearches, onPinsChanged: pins => { state.pinnedSearches = pins; saveState(); }, activePlaylist: state.activePlaylist, onPlay: item => openOnlinePlaylist(item, true), onSong: (item, autoplay) => {
  let track = state.playlist.find(track => track.id === item.id);
  if (!track) {
    if (state.playlist.length >= 500) throw new Error('The queue is full (500 songs).');
    track = { id: item.id, title: item.title, duration: item.duration || 0, start: 0, artist: item.artist || '', album: item.album || '', versions: cleanVersions(item.versions) };
    state.playlist.push(track); state.activePlaylist = null;
  }
  renderPlaylist(); if (autoplay) selectTrack(track.id, true); persist();
}, isQueued: id => state.playlist.some(track => track.id === id), onUnqueue: item => removeTrack(item.id), onSignIn: () => accountAction('library'), onLayout: () => panels.refresh() });
$('#reset-layout').onclick = () => panels.reset();
$('#compact-main').onclick = () => { const body = $('#main-body'); body.hidden = !body.hidden; $('#compact-main').setAttribute('aria-expanded', String(!body.hidden)); panels.refresh(); };
$('#fullscreen').onclick = async () => { if (window.yinampDesktop) { player.fullscreen(); return; } try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#video-viewport').requestFullscreen(); } catch { notify('Use the fullscreen button inside the YouTube video on this browser.'); } };
$('#play').onclick = play; $('#pause').onclick = pause; $('#stop').onclick = stop;
$('#next').onclick = () => navigate(1); $('#previous').onclick = () => navigate(-1);
$('#volume').oninput = event => setVolume(event.target.value);
$('#volume').addEventListener('pointerdown', () => { adjustingVolume = true; });
function finishVolumeAdjustment() {
  if (adjustingVolume) volumeSync.request(ui.volume.value, ui.muted.value);
  adjustingVolume = false;
}
window.addEventListener('pointerup', finishVolumeAdjustment);
window.addEventListener('pointercancel', finishVolumeAdjustment);
window.addEventListener('blur', finishVolumeAdjustment);
$('#mute').onclick = toggleMute;
$('#shuffle').onclick = () => { ui.shuffle.value = !ui.shuffle.value; persist(); };
$('#repeat').onclick = () => { ui.repeat.value = { off: 'all', all: 'one', one: 'off' }[ui.repeat.value]; persist(); };
$('#toggle-eq').onclick = () => togglePanel('eq'); $('#toggle-playlist').onclick = () => togglePanel('playlist');
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => togglePanel(button.dataset.close);
$('#retry-player').onclick = () => retryPlayer(true);
$('#retry-unavailable').onclick = retryUnavailable;
$('#seek').oninput = event => { seeking = true; $('#time').textContent = formatTime(event.target.value); };
$('#seek').onchange = event => { stopped = false; player.seek(Number(event.target.value)); seeking = false; };
$('#seek').addEventListener('pointercancel', () => { seeking = false; });
$('#seek').addEventListener('blur', () => { seeking = false; });

// Inline add row in the playlist window: one link field whose buttons follow the pasted link.
function parsedAddInput() { try { return parseYouTubeInput($('#video-url').value); } catch { return null; } }
function setAddNote(text) { $('#add-status').textContent = text; $('#add-status').hidden = !text; }
function showAddError(text) { $('#add-error').textContent = text; $('#add-error').hidden = false; }
function updateAddForm() {
  if (playlistImport) return;
  const parsed = parsedAddInput(), isPlaylist = parsed?.type === 'playlist';
  $('#add-submit').textContent = !isPlaylist ? 'ADD' : parsed.video ? 'ADD SONG' : 'REPLACE LIST';
  $('#add-replace').textContent = 'REPLACE LIST';
  $('#add-replace').hidden = !(isPlaylist && parsed.video);
  setAddNote('');
}
function setAddBusy(busy, button = $('#add-submit')) {
  $('#add-form').setAttribute('aria-busy', String(busy));
  for (const id of ['video-url', 'add-submit', 'add-replace']) $(`#${id}`).disabled = busy;
  if (busy) { button.replaceChildren(createLoader(), document.createTextNode('LOADING…')); setAddNote('Loading the playlist from YouTube…'); }
  else updateAddForm();
}
function openAdd() {
  if (!ui.visibility.playlist.value) togglePanel('playlist');
  $('#add-error').hidden = true;
  $('.playlist-toolbar').hidden = true; $('#add-form').hidden = false;
  updateAddForm(); panels.refresh();
  $('#video-url').focus();
}
function closeAdd() {
  const hadFocus = $('#add-form').contains(document.activeElement);
  playlistImport?.abort(); playlistImport = null; setAddBusy(false);
  $('#add-form').reset(); $('#add-form').hidden = true; $('.playlist-toolbar').hidden = false;
  $('#add-error').hidden = true; setAddNote('');
  panels.refresh();
  if (hadFocus) $('#playlist-add').focus({ preventScroll: true });
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
$('#video-url').oninput = () => { $('#add-error').hidden = true; updateAddForm(); };
$('#video-url').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeAdd(); } });
$('#add-cancel').onclick = closeAdd;
// Clicking away from an empty field closes it; switching apps (e.g. to copy a link) does not.
$('#add-form').addEventListener('focusout', () => setTimeout(() => {
  if (!$('#add-form').hidden && !playlistImport && document.hasFocus() && !$('#add-form').contains(document.activeElement) && !$('#video-url').value.trim()) closeAdd();
}, 0));

async function fetchPlaylistInfo(id) {
  try {
    const response = await fetch(`/api/playlist-info?id=${encodeURIComponent(id)}`);
    return response.ok ? await response.json() : null;
  } catch { return null; } // The playlist still plays without its name.
}
// Opening a playlist resolves as soon as the queue is in place: on the desktop that is the first page
// of songs, and the rest stream in behind it (`completion` settles once the whole list has arrived).
async function openOnlinePlaylist(value, autoplay = false, options = {}) {
  const id = value.id ?? value.playlistId;
  // Show the incoming playlist at once; the current queue keeps playing underneath until its songs arrive.
  // A pasted link has no name or cover yet, so ask for them alongside the songs rather than after.
  const loading = loadingPlaylist = { id, title: value.title || '', thumbnail: value.thumbnail || '' };
  const stream = { value, autoplay, options, loading, info: null, infoRequest: null, list: null, seen: new Set(), overflow: 0 };
  stream.infoRequest = value.title ? null : fetchPlaylistInfo(id).then(data => {
    stream.info = data;
    if (data && loadingPlaylist === loading) { loading.title ||= data.title; loading.thumbnail ||= data.thumbnail ?? ''; renderPlaylist(); }
    return data;
  });
  renderPlaylist();
  let markApplied;
  const applied = new Promise(resolve => { markApplied = resolve; });
  const requestId = crypto.randomUUID();
  const unsubscribe = window.yinampDesktop?.onPlaylistProgress?.(data => {
    if (data?.requestId === requestId && Array.isArray(data.tracks) && addStreamedTracks(stream, data.tracks)) markApplied();
  });
  const completion = (async () => {
    try {
      const source = await readPlaylistSource(value, options, requestId);
      if (options.signal?.aborted && !stream.list) throw new DOMException('Playlist import cancelled', 'AbortError');
      stream.sourceTitle = source.title;
      const tracks = source.tracks ?? source.ids.map(trackId => ({ id: trackId }));
      if (!addStreamedTracks(stream, tracks) && !stream.list) throw new Error('No available songs were found. Your previous queue is unchanged.');
      markApplied();
      return { partial: source.partial || stream.overflow > 0, count: stream.list?.length ?? 0, list: stream.list };
    } finally {
      unsubscribe?.();
      if (loadingPlaylist === loading) loadingPlaylist = null;
      if (streamingList === stream.list) streamingList = null;
      renderPlaylist();
    }
  })();
  completion.catch(() => {});
  // The queue is in place after the first page (or the whole list); a failure before that rejects.
  await Promise.race([applied, completion]);
  return { completion, count: stream.list.length, list: stream.list };
}
function readPlaylistSource(value, options, requestId) {
  if (window.yinampDesktop?.library) return window.yinampDesktop.library({ action: 'playlist', requestId, playlist: { id: value.id ?? value.playlistId, seed: value.seed ?? value.video?.id ?? null, source: value.source ?? 'youtube' } });
  if (value.source === 'music') return (async () => { const response = await fetch(`/api/playlist?id=${encodeURIComponent(value.id ?? value.playlistId)}&source=music`, { signal: options.signal }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })();
  return readPlaylistWithFallback(value.id ?? value.playlistId, { container: $('#playlist-preview'), ...options });
}
function trackFromSource(data) {
  const track = { id: data.id, title: `YouTube — ${data.id}`, duration: 0, start: 0 };
  if (typeof data.title === 'string') track.title = data.title.slice(0, 300);
  for (const field of ['artist', 'album']) if (typeof data[field] === 'string' && data[field].trim()) track[field] = data[field].trim().slice(0, 300);
  if (Number.isFinite(data.duration)) track.duration = clamp(data.duration, 0, 604800);
  const versions = cleanVersions(data.versions);
  if (Object.keys(versions).length) track.versions = versions;
  return track;
}
// Add a batch of streamed songs. The first batch replaces the queue; later ones append songs not seen
// before, so anything the user removed meanwhile stays removed. Returns true once the queue is in place.
function addStreamedTracks(stream, tracks) {
  if (stream.list ? state.playlist !== stream.list : stream.options.signal?.aborted) return Boolean(stream.list); // replaced or cancelled
  const fresh = [];
  for (const data of tracks) {
    if (!/^[\w-]{11}$/.test(data?.id ?? '') || stream.seen.has(data.id)) continue;
    stream.seen.add(data.id);
    if ((stream.list?.length ?? 0) + fresh.length >= 500) { stream.overflow++; continue; }
    fresh.push(trackFromSource(data));
  }
  if (!fresh.length) return Boolean(stream.list);
  const untitled = fresh.filter(track => track.title === `YouTube — ${track.id}`);
  if (stream.list) {
    for (const track of fresh) if (!stream.list.some(existing => existing.id === track.id)) stream.list.push(track);
    renderPlaylist(); persist();
    void fillTrackTitles(untitled);
    return true;
  }
  // Name and cover: the card's, the listing's, or YouTube's answer; until that arrives, the first video's thumbnail.
  const { value, loading, info, infoRequest } = stream;
  const title = value.title || stream.sourceTitle || info?.title;
  if (loadingPlaylist === loading) loadingPlaylist = null;
  stop();
  state.activePlaylist = normalizePlaylistIdentity({ ...value, title, thumbnail: value.thumbnail || info?.thumbnail || `https://i.ytimg.com/vi/${fresh[0].id}/hqdefault.jpg` });
  state.playlist = stream.list = streamingList = fresh; ui.selectedId.value = fresh[0].id;
  const id = state.activePlaylist?.id;
  if (!title && infoRequest) void infoRequest.then(data => {
    if (!data || state.activePlaylist?.id !== id || state.activePlaylist.title === data.title) return;
    state.activePlaylist = normalizePlaylistIdentity({ ...state.activePlaylist, title: data.title, thumbnail: data.thumbnail ?? state.activePlaylist.thumbnail });
    renderPlaylist(); persist();
  });
  queueEntrance = performance.now(); renderPlaylist(); selectTrack(ui.selectedId.value, stream.autoplay); persist();
  void fillTrackTitles(untitled);
  return true;
}

async function replaceQueueFrom(playlist, button) {
  const controller = new AbortController();
  playlistImport = controller;
  $('#add-error').hidden = true;
  setAddBusy(true, button);
  try {
    const result = await openOnlinePlaylist(playlist, false, { signal: controller.signal, onFallback: () => setAddNote('Reading the public playlist listing…') });
    if (controller.signal.aborted) return;
    playlistImport = null; closeAdd();
    // The rest may still be streaming in; report a partial list once it has all arrived.
    const current = () => state.playlist === result.list;
    result.completion.then(done => { if (current()) flashSummary(done.partial ? { text: 'PARTIAL', title: 'Only part of this playlist could be loaded.' } : null); },
      () => { if (current()) flashSummary({ text: 'PARTIAL', title: 'The rest of this playlist could not be loaded.' }); });
  } catch (error) {
    if (error.name !== 'AbortError' && !controller.signal.aborted) showAddError(error.message);
  } finally {
    if (playlistImport === controller) { playlistImport = null; setAddBusy(false); }
  }
}
function addSong({ id, start }) {
  // Already queued: point at it without interrupting what is playing.
  if (state.playlist.some(track => track.id === id)) { closeAdd(); flashRow(id); return; }
  if (state.playlist.length >= 500) { showAddError('Your playlist is full (500 tracks). Remove a track first.'); return; }
  const track = { id, start, title: `YouTube — ${id}`, duration: 0 };
  state.activePlaylist = null;
  state.playlist.push(track);
  renderPlaylist();
  if (!ui.selectedId.value) selectTrack(track.id); else persist();
  closeAdd(); flashRow(track.id);
  void fillTrackTitles([track]);
}
$('#add-form').onsubmit = event => {
  event.preventDefault();
  if (playlistImport) return;
  let parsed;
  try { parsed = parseYouTubeInput($('#video-url').value); }
  catch (error) { showAddError(error.message); return; }
  if (parsed.type === 'playlist' && !parsed.video) void replaceQueueFrom(parsed, $('#add-submit'));
  else addSong(parsed.type === 'playlist' ? parsed.video : parsed);
};
$('#add-replace').onclick = () => {
  const parsed = parsedAddInput();
  if (!playlistImport && parsed?.type === 'playlist') void replaceQueueFrom(parsed, $('#add-replace'));
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
    $('#skin-error').hidden = true; renderSkin(); persist();
  } catch (error) { $('#skin-error').textContent = error instanceof SyntaxError ? 'That file is not valid JSON.' : error.message; $('#skin-error').hidden = false; }
};
$('#export-playlist').onclick = () => download({ version: 1, name: 'Yinamp playlist', tracks: state.playlist }, 'yinamp-playlist.json');
$('#import-playlist').onclick = () => $('#playlist-file').click();
$('#clear-playlist').onclick = clearPlaylist;
$('#playlist-file').onchange = async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 1048576) throw new Error('Playlist files must be smaller than 1 MB.');
    const data = JSON.parse(await file.text());
    if (data.version !== 1 || !Array.isArray(data.tracks) || data.tracks.length > 500 || data.tracks.some(track => !track || !/^[\w-]{11}$/.test(track.id))) throw new Error('Use a Yinamp playlist JSON file with up to 500 valid videos.');
    const imported = initialState({ version: 2, playlist: data.tracks });
    resetEmbedFailures(imported.playlist);
    stop(); state.activePlaylist = null; state.playlist = imported.playlist; ui.selectedId.value = imported.selectedId;
    queueEntrance = performance.now(); renderPlaylist();
    if (currentTrack()) selectTrack(ui.selectedId.value);
    else { loadRecording(null); void resolveVersions(); ui.playback.value = 'EMPTY'; updateTrack(); renderPlaylist(); persist(); }
    flashSummary();
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
effect(() => { ui.selectedId.value; refreshPlaylistNavigation(); });
loadRecording(currentTrack(), false);
player.initialize();
void resolveVersions();
setInterval(updateProgress, 350);
if (!storageAvailable) notify('Browser storage is unavailable. Use SAVE to export your playlist.', true);
window.addEventListener('pagehide', persistence.flush);
window.addEventListener('beforeunload', persistence.flush);
document.addEventListener('visibilitychange', () => { if (document.hidden) persistence.flush(); });
window.yinampDesktop?.onFlushState?.(snapshot);
void window.yinampDesktop?.ready?.();
