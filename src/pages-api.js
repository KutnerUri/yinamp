import { DEMO_PLAYLISTS } from './pages-playlists.js';

// A small offline catalog, not a substitute for live YouTube search.
export function demoAPIResponse(url) {
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  if (url.pathname === '/api/library' && url.searchParams.get('section') === 'discover') {
    return json({ items: DEMO_PLAYLISTS.map(({ tracks, url, ...card }) => card), partial: false });
  }
  if (url.pathname === '/api/playlist') {
    const playlist = DEMO_PLAYLISTS.find(item => item.id === url.searchParams.get('id'));
    if (playlist) return json({ title: playlist.title, tracks: playlist.tracks, partial: playlist.partial === true });
  }
  if (url.pathname === '/api/video') {
    const track = DEMO_PLAYLISTS.flatMap(item => item.tracks).find(item => item.id === url.searchParams.get('id'));
    if (track) return json({ title: track.title });
  }
  if (url.pathname === '/api/search-suggestions') return json([]);
  return json({ error: 'Live music search needs the local app. Choose a featured playlist from Discovery, add a YouTube video link, or run Yinamp locally.' }, 503);
}
