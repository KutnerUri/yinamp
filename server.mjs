import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { parsePlaylistListing } from './playlist-listing.mjs';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const metadataCache = new Map();

export function createAppServer({ fetcher = fetch } = {}) {
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
      if (url.pathname === '/api/playlist') {
        const id = url.searchParams.get('id');
        if (!/^[\w-]{2,150}$/.test(id ?? '')) return send(400, JSON.stringify({ error: 'Invalid YouTube playlist ID' }));
        try {
          const endpoint = new URL('https://www.youtube.com/playlist');
          endpoint.searchParams.set('list', id);
          endpoint.searchParams.set('hl', 'en');
          const upstream = await fetcher(endpoint, { signal: AbortSignal.timeout(8000) });
          if (!upstream.ok) throw new Error('YouTube’s public playlist listing is unavailable. Please try again.');
          const html = await upstream.text();
          if (html.length > 5000000) throw new Error('This playlist listing is too large to import.');
          return send(200, JSON.stringify(parsePlaylistListing(html, id)));
        } catch (error) {
          const message = error.name === 'TimeoutError' ? 'YouTube’s playlist listing took too long to respond. Please try again.' : error instanceof SyntaxError ? 'YouTube’s playlist listing could not be read. Please try again.' : error.message;
          return send(502, JSON.stringify({ error: message }));
        }
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
      send(200, content, type);
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
