import { musicPageData } from './music-library.mjs';
import { parseMusicLibrary } from './src/library-data.js';

const origin = 'https://music.youtube.com';
const agent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
const categories = { community: 'Community playlists', featured: 'Featured playlists', songs: 'Songs' };
const text = value => value?.simpleText ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';

// Only inspect JSON. Never execute a page script or export its session configuration.
export function musicSearchConfiguration(html) {
  let clientVersion;
  for (const match of html.matchAll(/ytcfg\.set\((\{[\s\S]*?\})\);/g)) {
    try {
      const value = JSON.parse(match[1]);
      clientVersion ??= value.INNERTUBE_CLIENT_VERSION ?? value.INNERTUBE_CONTEXT?.client?.clientVersion;
    } catch { /* A non-JSON script is not configuration. */ }
  }
  const filters = {};
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    const chip = value.chipCloudChipRenderer;
    if (chip?.navigationEndpoint?.searchEndpoint?.params) {
      for (const [key, label] of Object.entries(categories)) if (text(chip.text) === label) filters[key] = chip.navigationEndpoint.searchEndpoint.params;
    }
    for (const [key, child] of Object.entries(value)) if (!['menu', 'responseContext', 'trackingParams'].includes(key)) walk(child);
  }
  walk(musicPageData(html));
  if (typeof clientVersion !== 'string' || clientVersion.length > 100) throw new Error('YouTube Music search configuration could not load. Try refreshing.');
  return { clientVersion, filters };
}

export function musicContinuations(data) {
  const tokens = new Set();
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    const token = value.nextContinuationData?.continuation ?? value.continuationCommand?.token;
    if (typeof token === 'string' && token.length <= 20000) tokens.add(token);
    for (const [key, child] of Object.entries(value)) if (!['menu', 'responseContext', 'trackingParams'].includes(key)) walk(child);
  }
  walk(data);
  return [...tokens];
}

export async function requestMusicPage({ fetcher = fetch, clientVersion, action = 'search', signal, ...parameters }) {
  if (!['search', 'browse'].includes(action)) throw new Error('Unknown music request.');
  const response = await fetcher(`${origin}/youtubei/v1/${action}?prettyPrint=false`, {
    method: 'POST', credentials: 'include', signal: signal ?? AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json', Origin: origin, 'User-Agent': agent },
    body: JSON.stringify({ context: { client: { clientName: 'WEB_REMIX', clientVersion, hl: 'en' } }, ...parameters }),
  });
  if (!response.ok) throw new Error('YouTube Music could not load the requested results. Try refreshing.');
  const data = await response.json();
  if (data.error) throw new Error('YouTube Music could not load the requested results. Try refreshing.');
  return data;
}

export async function queryMusicPlaylists({ query = 'music', category = 'community', fetcher = fetch, maxPages = 3, limit = 120, signal, configuration } = {}) {
  if (!['community', 'featured'].includes(category)) throw new Error('Unknown playlist category.');
  if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Enter a search of up to 200 characters.');
  if (!configuration) {
    const url = new URL(`${origin}/search`); url.searchParams.set('q', query); url.searchParams.set('hl', 'en');
    const response = await fetcher(url.href, { credentials: 'include', signal: signal ?? AbortSignal.timeout(10000), headers: { 'User-Agent': agent } });
    if (!response.ok) throw new Error('YouTube Music search could not load. Try refreshing.');
    configuration = musicSearchConfiguration(await response.text());
  }
  const params = configuration.filters[category];
  if (!params) throw new Error('YouTube Music did not provide this playlist category. Try refreshing.');
  const items = new Map(), seen = new Set();
  let continuation, pages = 0, truncated = false, repeated = false;
  do {
    const data = await requestMusicPage({ fetcher, clientVersion: configuration.clientVersion, signal, ...(continuation ? { continuation } : { query: query.trim(), params }) });
    pages++;
    for (const item of parseMusicLibrary(data).items) {
      if (items.has(item.id) || items.size < limit) items.set(item.id, { ...item, community: category === 'community' });
      else truncated = true;
    }
    const tokens = musicContinuations(data);
    continuation = tokens.find(token => !seen.has(token));
    repeated = tokens.length > 0 && !continuation;
    if (continuation) seen.add(continuation);
  } while (continuation && pages < maxPages && items.size < limit);
  return { items: [...items.values()], partial: Boolean(continuation) || truncated || repeated };
}

export async function discoverMusicPlaylists(options = {}) {
  // A broad music query, not an inferred genre preference. Search UI can later supply explicit interests.
  const community = await queryMusicPlaylists({ ...options, category: 'community' });
  const featured = await queryMusicPlaylists({ ...options, category: 'featured' });
  const items = new Map();
  for (const item of [...community.items, ...featured.items]) if (!items.has(item.id)) items.set(item.id, item);
  return { items: [...items.values()], partial: community.partial || featured.partial };
}
