import { stampAppVersion } from './app-version.mjs';
import { queryTrackVersions } from './music-versions.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { parsePlaylistListing } from './playlist-listing.mjs';
import { parseMusicPlaylistHTML } from './music-library.mjs';
import { searchMusic, suggestMusic, discoverMusicPlaylists } from './music-query.mjs';
import { PlaylistCache } from './src/playlist-cache.js';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const metadataCache = new Map();

export function createAppServer({ fetcher = fetch } = {}) {
  const catalogCache = new PlaylistCache(), playlistCache = new PlaylistCache();
  let searchWork = Promise.resolve();
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Cache-Control', 'no-cache');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(405, JSON.stringify({ error: 'Method not allowed' }));
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      // Expose only this dependency's ESM entry, keeping the app build-free.
      if (url.pathname === '/src/vendor/signals-core.js') {
        return send(200, await readFile(fileURLToPath(import.meta.resolve('@preact/signals-core'))), mime['.js']);
      }
      if (url.pathname === '/api/search-suggestions') {
        try { return send(200, JSON.stringify(await suggestMusic(url.searchParams.get('q'), fetcher))); }
        catch { return send(200, '[]'); }
      }
      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q'), type = url.searchParams.get('type') || 'all', pages = Number(url.searchParams.get('pages') || 1);
        if (!query?.trim() || query.length > 200 || !['all', 'songs', 'playlists'].includes(type) || !Number.isInteger(pages) || pages < 1 || pages > 10) return send(400, JSON.stringify({ error: 'Invalid search options.' }));
        try {
          const key = `search:${JSON.stringify([query, type, pages])}`;
          const cached = url.searchParams.get('refresh') !== '1' && catalogCache.get(key);
          const data = cached || await (searchWork = searchWork.catch(() => {}).then(() => searchMusic({ query, type, pages, fetcher, signal: AbortSignal.timeout(30000) }))); catalogCache.set(key, data);
          return send(200, JSON.stringify(data));
        } catch { return send(502, JSON.stringify({ error: 'YouTube Music search could not load. Try again.' })); }
      }
      if (url.pathname === '/api/library') {
        if (url.searchParams.get('section') !== 'discover') return send(400, JSON.stringify({ error: 'Personal library views use the desktop app.' }));
        try {
          if (url.searchParams.get('refresh') === '1') { catalogCache.clear(); playlistCache.clear(); }
          const cached = catalogCache.get('discover');
          if (cached) return send(200, JSON.stringify(cached));
          const data = await discoverMusicPlaylists({ fetcher, signal: AbortSignal.timeout(30000) }); catalogCache.set('discover', data);
          return send(200, JSON.stringify(data));
        } catch { return send(502, JSON.stringify({ error: 'Music suggestions could not load. Try refreshing.' })); }
      }
      if (url.pathname === '/api/playlist') {
        const id = url.searchParams.get('id');
        if (!/^[\w-]{2,150}$/.test(id ?? '')) return send(400, JSON.stringify({ error: 'Invalid YouTube playlist ID' }));
        try {
          const music = url.searchParams.get('source') === 'music';
          const key = `${music ? 'music' : 'youtube'}:${id}`;
          const cached = playlistCache.get(key);
          if (cached) return send(200, JSON.stringify(cached));
          const endpoint = new URL(music ? 'https://music.youtube.com/playlist' : 'https://www.youtube.com/playlist');
          endpoint.searchParams.set('list', id);
          endpoint.searchParams.set('hl', 'en');
          const upstream = await fetcher(endpoint, { signal: AbortSignal.timeout(8000), ...(music ? { headers: { 'User-Agent': request.headers['user-agent'] || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36' } } : {}) });
          if (!upstream.ok) throw new Error('YouTube’s public playlist listing is unavailable. Please try again.');
          const html = await upstream.text();
          if (html.length > 5000000) throw new Error('This playlist listing is too large to import.');
          const data = music ? parseMusicPlaylistHTML(html) : parsePlaylistListing(html, id);
          if (!data.tracks.length) throw new Error('This playlist is empty or unavailable.');
          playlistCache.set(key, data);
          return send(200, JSON.stringify(data));
        } catch (error) {
          const message = error.name === 'TimeoutError' ? 'YouTube’s playlist listing took too long to respond. Please try again.' : error instanceof SyntaxError ? 'YouTube’s playlist listing could not be read. Please try again.' : error.message;
          return send(502, JSON.stringify({ error: message }));
        }
      }
      if (url.pathname === '/api/track-versions') {
        const id = url.searchParams.get('id');
        if (!/^[\w-]{11}$/.test(id ?? '')) return send(400, JSON.stringify({ error: 'Invalid YouTube track ID' }));
        const key = `versions:${id}`;
        const cached = playlistCache.get(key);
        if (cached) return send(200, JSON.stringify(cached));
        try {
          const result = await queryTrackVersions({ id, fetcher });
          playlistCache.set(key, result);
          return send(200, JSON.stringify(result));
        } catch { return send(502, JSON.stringify({ error: 'Song and video versions could not load. Try again.' })); }
      }
      if (url.pathname === '/api/video') {
        const id = url.searchParams.get('id');
        if (!/^[\w-]{11}$/.test(id ?? '')) return send(400, JSON.stringify({ error: 'Invalid YouTube video ID' }));
        if (metadataCache.has(id)) return send(200, JSON.stringify(metadataCache.get(id)));
        try {
          const endpoint = new URL('https://www.youtube.com/oembed');
          endpoint.searchParams.set('url', `https://www.youtube.com/watch?v=${id}`);
          endpoint.searchParams.set('format', 'json');
          const upstream = await fetcher(endpoint, { signal: AbortSignal.timeout(8000) });
          if (!upstream.ok) throw new Error('Video metadata unavailable');
          const data = await upstream.json();
          if (typeof data.title !== 'string') throw new Error('Invalid video metadata');
          const metadata = { id, title: data.title.slice(0, 300), author: String(data.author_name ?? '').slice(0, 200) };
          if (metadataCache.size > 200) metadataCache.delete(metadataCache.keys().next().value);
          metadataCache.set(id, metadata);
          return send(200, JSON.stringify(metadata));
        } catch {
          return send(502, JSON.stringify({ error: 'Title unavailable. You can still add and play this video.' }));
        }
      }
      const pathname = decodeURIComponent(url.pathname);
      const asset = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (asset !== 'index.html' && !/^(src|skins)\/[a-zA-Z0-9_./-]+$/.test(asset)) return send(404, 'Not found', 'text/plain');
      const path = resolve(root, asset);
      if (!path.startsWith(root + sep) || asset.split('/').some(part => part.startsWith('.'))) return send(404, 'Not found', 'text/plain');
      const type = mime[extname(path)];
      if (!type) return send(404, 'Not found', 'text/plain');
      const content = await readFile(path);
      send(200, asset === 'index.html' ? stampAppVersion(content.toString('utf8')) : content, type);
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 400, 'Not found', 'text/plain');
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 5173);
  const server = createAppServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Try PORT=5174 npm run dev.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`\n  YINAMP  ▸  http://127.0.0.1:${port}\n`));
}
