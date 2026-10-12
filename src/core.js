export const STORAGE_KEY = 'yinamp.v1';
export const DEFAULT_TRACKS = [
  { id: 'K4DyBUG242c', title: 'Cartoon — On & On', duration: 0 },
  { id: 'J2X5mJ3HDYE', title: 'DEAF KEV — Invincible', duration: 0 },
  { id: 'jK2aIUmmdP4', title: 'Different Heaven & EH!DE — My Heart', duration: 0 },
];
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
  const state = { playlist: structuredClone(DEFAULT_TRACKS), selectedId: DEFAULT_TRACKS[0].id, volume: 75, muted: false, shuffle: false, repeat: 'off', skin: structuredClone(SKINS.classic), visibility: { eq: true, playlist: true }, layout: {} };
  if (!saved || typeof saved !== 'object') return state;
  if (Array.isArray(saved.playlist)) {
    const seen = new Set();
    state.playlist = saved.playlist.filter(t => t && /^[\w-]{11}$/.test(t.id) && !seen.has(t.id) && seen.add(t.id)).slice(0, 500).map(t => ({ id: t.id, title: typeof t.title === 'string' ? t.title.slice(0, 300) : `YouTube — ${t.id}`, duration: clamp(t.duration, 0, 604800), start: clamp(t.start, 0, 86400) }));
    state.selectedId = state.playlist.some(t => t.id === saved.selectedId) ? saved.selectedId : state.playlist[0]?.id ?? null;
  }
  if (typeof saved.volume === 'number') state.volume = clamp(saved.volume, 0, 100);
  state.muted = saved.muted === true;
  state.shuffle = saved.shuffle === true;
  if (['off', 'all', 'one'].includes(saved.repeat)) state.repeat = saved.repeat;
  try { if (saved.skin) state.skin = validateSkin(saved.skin); } catch { /* Fall back to the classic skin. */ }
  for (const key of ['eq', 'playlist']) if (typeof saved.visibility?.[key] === 'boolean') state.visibility[key] = saved.visibility[key];
  for (const key of ['main', 'eq', 'video', 'playlist']) {
    const point = saved.layout?.[key];
    if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) state.layout[key] = { x: clamp(point.x, 0, 3000), y: clamp(point.y, 0, 3000) };
  }
  return state;
}

export function nextTrackIndex(state, { direction = 1, automatic = false, random = Math.random } = {}) {
  const count = state.playlist.length;
  if (!count) return -1;
  const current = state.playlist.findIndex(t => t.id === state.selectedId);
  if (current < 0) return 0;
  if (automatic && state.repeat === 'one') return current;
  if (state.shuffle && count > 1) {
    const offset = 1 + Math.floor(clamp(random(), 0, 0.999999) * (count - 1));
    return (current + offset) % count;
  }
  const next = current + direction;
  if (automatic && next >= count && state.repeat === 'off') return -1;
  return (next + count) % count;
}

export function formatTime(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
