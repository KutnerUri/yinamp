import { requestMusicPage } from './music-query.mjs';
import { parsePlaylistTracks } from './src/library-data.js';
import { cleanVersions } from './src/track-versions.js';

// Resolve provider-declared counterparts, never a title search or radio neighbour.
export async function queryTrackVersions({ id, fetcher = fetch, signal } = {}) {
  if (!/^[\w-]{11}$/.test(id ?? '')) throw new Error('Invalid YouTube track ID');
  signal ??= AbortSignal.timeout(15000);
  const url = new URL('https://music.youtube.com/watch');
  url.searchParams.set('v', id); url.searchParams.set('hl', 'en');
  const response = await fetcher(url.href, { credentials: 'include', signal,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' } });
  if (!response.ok) throw new Error('Song and video versions could not load.');
  const html = await response.text();
  let clientVersion;
  for (const match of html.matchAll(/ytcfg\.set\((\{[\s\S]*?\})\);/g)) {
    try {
      const config = JSON.parse(match[1]);
      clientVersion ??= config.INNERTUBE_CLIENT_VERSION ?? config.INNERTUBE_CONTEXT?.client?.clientVersion;
    } catch { /* Ignore unrelated page scripts. */ }
  }
  if (typeof clientVersion !== 'string' || clientVersion.length > 100) throw new Error('YouTube Music did not provide version information.');
  const data = await requestMusicPage({ fetcher, clientVersion, action: 'next', signal,
    videoId: id, playlistId: `RDAMVM${id}`, enablePersistentPlaylistPanel: true, isAudioOnly: true,
    tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' });
  const track = parsePlaylistTracks(data).tracks.find(track => track.id === id || Object.values(track.versions ?? {}).some(version => version.id === id));
  return { versions: cleanVersions(track?.versions), ...Object.fromEntries(['artist', 'album'].filter(field => track?.[field]).map(field => [field, track[field]])) };
}
