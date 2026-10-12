import { cleanVersions } from './track-versions.js';
export const STORAGE_KEY = 'yinamp.v1';
export const RETRY_AFTER_MS = 15 * 60 * 1000;
export const TRACK_ERROR_CODES = new Set([2, 5, 100, 101, 150]);
export const canAttemptTrack = (track, now = Date.now()) => !track.unavailable || now - track.unavailable.checkedAt >= RETRY_AFTER_MS;
export const LEGACY_DEMO_TRACKS = [
  { id: 'K4DyBUG242c', title: 'Cartoon — On & On', duration: 0 },
  { id: 'J2X5mJ3HDYE', title: 'DEAF KEV — Invincible', duration: 0 },
  { id: 'jK2aIUmmdP4', title: 'Different Heaven & EH!DE — My Heart', duration: 0 },
];
export const DEFAULT_TRACKS = [];
export const SKINS = {
  classic: { version: 1, name: 'Classic', colors: { shell: '#30313f', edge: '#7c7e91', accent: '#a7ff48', screen: '#080e08', text: '#dddde7', button: '#aeb0bf', desktop: '#14151e' } },
  amber: { version: 1, name: 'Amber', colors: { shell: '#3d332d', edge: '#9b8773', accent: '#ffd16d', screen: '#160e06', text: '#f0e1ce', button: '#c2a78c', desktop: '#1c1714' } },
  ice: { version: 1, name: 'Ice', colors: { shell: '#293747', edge: '#6f90ab', accent: '#6ee8ff', screen: '#06111b', text: '#dcecf6', button: '#9ebcd2', desktop: '#111b28' } },
};
export const clamp = (number, min, max) => Math.min(max, Math.max(min, Number(number) || 0));

export function parseVideoInput(input) {
  const value = String(input).trim();
  if (/^[\w-]{11}$/.test(value)) return { id: value, start: 0 };
  let url;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { throw new Error('Paste a YouTube video link or an 11-character video ID.'); }
  const host = url.hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host) || !['https:', 'http:'].includes(url.protocol)) throw new Error('Use a link from youtube.com or youtu.be.');
  const segments = url.pathname.split('/').filter(Boolean);
  const id = host.endsWith('youtu.be') ? segments[0] : url.searchParams.get('v') ?? (['embed', 'shorts', 'live', 'v'].includes(segments[0]) ? segments[1] : null);
  if (!/^[\w-]{11}$/.test(id ?? '')) throw new Error('That link needs a video. Open a video on YouTube and copy its link.');
  const time = url.searchParams.get('t') ?? url.searchParams.get('start') ?? '';
  let start = 0;
  if (/^\d+$/.test(time)) start = Number(time);
  else if (/^(?:\d+h)?(?:\d+m)?(?:\d+s)?$/.test(time)) {
    start = Number(time.match(/(\d+)h/)?.[1] ?? 0) * 3600 + Number(time.match(/(\d+)m/)?.[1] ?? 0) * 60 + Number(time.match(/(\d+)s/)?.[1] ?? 0);
  }
  return { id, start: clamp(start, 0, 86400) };
}

export function parseYouTubeInput(input) {
  const value = String(input).trim();
  if (/^[\w-]{11}$/.test(value)) return { type: 'video', ...parseVideoInput(value) };
  let url;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); }
  catch { throw new Error('Paste a YouTube video or playlist link.'); }
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.hostname.toLowerCase()) || !['https:', 'http:'].includes(url.protocol)) throw new Error('Use a link from youtube.com or youtu.be.');
  if (!url.searchParams.has('list')) return { type: 'video', ...parseVideoInput(value) };
  const playlistId = url.searchParams.get('list');
  if (!/^[\w-]{2,150}$/.test(playlistId)) throw new Error('That playlist link needs a valid playlist ID. Copy its link from YouTube.');
  let video = null;
  try { video = parseVideoInput(value); } catch { /* Playlist-only links do not need a video. */ }
  return { type: 'playlist', playlistId, video };
}

export function appendPlaylistTracks(existing, videoIds, limit = 500) {
  const seen = new Set(existing.map(track => track.id));
  const added = [];
  let duplicates = 0;
  let overflow = 0;
  for (const id of new Set(videoIds)) {
    if (!/^[\w-]{11}$/.test(id)) continue;
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);
    if (existing.length + added.length >= limit) { overflow++; continue; }
    added.push({ id, title: `YouTube — ${id}`, duration: 0, start: 0 });
  }
  return { added, duplicates, overflow };
}

export function validateSkin(value) {
  if (!value || value.version !== 1 || typeof value.name !== 'string' || !value.name.trim() || !value.colors) throw new Error('Use a Yinamp skin with version 1, a name, and colors.');
  const colors = {};
  for (const key of Object.keys(SKINS.classic.colors)) {
    if (!/^#[0-9a-f]{6}$/i.test(value.colors[key] ?? '')) throw new Error(`Skin color “${key}” must be a six-digit hex color.`);
    colors[key] = value.colors[key];
  }
  return { version: 1, name: value.name.trim().slice(0, 40), colors };
}

export function initialState(saved) {
  const state = { version: 2, playlist: [], selectedId: null, volume: 75, muted: false, shuffle: false, repeat: 'off', skin: structuredClone(SKINS.classic), visibility: { eq: true, playlist: true }, layout: {} };
  if (!saved || typeof saved !== 'object') return state;
  if (Array.isArray(saved.playlist)) {
    const seen = new Set();
    // Older installations seeded exactly these three tracks at the front.
    // Migrate that prefix once; other saved tracks and settings are preserved.
    const legacyPrefix = saved.version !== 2 && LEGACY_DEMO_TRACKS.every((track, index) => saved.playlist[index]?.id === track.id);
    const playlist = legacyPrefix ? saved.playlist.slice(LEGACY_DEMO_TRACKS.length) : saved.playlist;
    state.playlist = playlist.filter(t => t && /^[\w-]{11}$/.test(t.id) && !seen.has(t.id) && seen.add(t.id)).slice(0, 500).map(t => {
      const track = { id: t.id, title: typeof t.title === 'string' ? t.title.slice(0, 300) : `YouTube — ${t.id}`, duration: clamp(t.duration, 0, 604800), start: clamp(t.start, 0, 86400) };
      for (const field of ['artist', 'album']) if (typeof t[field] === 'string' && t[field].trim()) track[field] = t[field].trim().slice(0, 300);
      if (TRACK_ERROR_CODES.has(t.unavailable?.code)) track.unavailable = { code: t.unavailable.code, message: typeof t.unavailable.message === 'string' ? t.unavailable.message.slice(0, 300) : 'This video could not be played.', checkedAt: Number.isFinite(t.unavailable.checkedAt) ? clamp(t.unavailable.checkedAt, 0, Date.now()) : 0 };
      if (t.versionsChecked === true) track.versionsChecked = true;
      const versions = cleanVersions(t.versions);
      if (Object.keys(versions).length) track.versions = versions;
      return track;
    });
    state.selectedId = state.playlist.some(t => t.id === saved.selectedId) ? saved.selectedId : state.playlist[0]?.id ?? null;
  }
  if (typeof saved.volume === 'number') state.volume = clamp(saved.volume, 0, 100);
  if (['song', 'video'].includes(saved.playbackMode)) state.playbackMode = saved.playbackMode;
  state.muted = saved.muted === true;
  state.shuffle = saved.shuffle === true;
  if (['off', 'all', 'one'].includes(saved.repeat)) state.repeat = saved.repeat;
  try { if (saved.skin) state.skin = validateSkin(saved.skin); } catch { /* Fall back to the classic skin. */ }
  for (const key of ['eq', 'playlist']) if (typeof saved.visibility?.[key] === 'boolean') state.visibility[key] = saved.visibility[key];
  for (const key of ['main', 'eq', 'video', 'playlist', 'library']) {
    const point = saved.layout?.[key];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) state.layout[key] = { x: clamp(point.x, 0, 3000), y: clamp(point.y, 0, 3000) };
  }
  return state;
}

export function nextTrackIndex(state, { direction = 1, automatic = false, skipCurrent = false, random = Math.random, now = Date.now() } = {}) {
  const count = state.playlist.length;
  if (!count) return -1;
  const current = state.playlist.findIndex(t => t.id === state.selectedId);
  if (current < 0) return state.playlist.findIndex(track => canAttemptTrack(track, now));
  if (automatic && !skipCurrent && state.repeat === 'one' && canAttemptTrack(state.playlist[current], now)) return current;
  if (state.shuffle) {
    const candidates = state.playlist.map((track, index) => ({ track, index })).filter(value => value.index !== current && canAttemptTrack(value.track, now));
    if (candidates.length) return candidates[Math.floor(clamp(random(), 0, 0.999999) * candidates.length)].index;
    return !skipCurrent && canAttemptTrack(state.playlist[current], now) && (!automatic || state.repeat !== 'off') ? current : -1;
  }
  for (let step = 1; step <= count; step++) {
    const raw = current + step * direction;
    if (automatic && state.repeat === 'off' && (raw >= count || raw < 0)) return -1;
    const index = (raw % count + count) % count;
    if (skipCurrent && index === current) continue;
    if (canAttemptTrack(state.playlist[index], now)) return index;
  }
  return -1;
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
