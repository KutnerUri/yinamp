import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { playlistPage } from './fixtures/playlist.mjs';

async function withServer(fetcher, run) {
  const server = createAppServer({ fetcher });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
test('serves the application with module MIME types and a YouTube-compatible referrer policy', async () => {
  await withServer(null, async base => {
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /YINAMP VIDEO/);
    assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const module = await fetch(`${base}/src/app.js`);
    assert.match(module.headers.get('content-type'), /javascript/);
    assert.equal(module.status, 200);
    const signals = await fetch(`${base}/src/vendor/signals-core.js`);
    assert.equal(signals.status, 200);
    assert.match(signals.headers.get('content-type'), /javascript/);
    assert.match(await signals.text(), /export\s*\{/);
    const head = await fetch(`${base}/`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  });
});
test('does not expose repository, server source, or paths outside the static directories', async () => {
  await withServer(null, async base => {
    for (const path of ['/.git/config', '/server.mjs', '/package.json', '/node_modules/@preact/signals-core/package.json', '/src/vendor/other.js', '/work/yinamp-preview.html', '/src/%2e%2e%2fserver.mjs', '/src/.secret.js']) assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  });
});
test('metadata lookup validates IDs before accessing the network and only contacts YouTube', async () => {
  const requests = [];
  await withServer(async url => { requests.push(url); return { ok: true, json: async () => ({ title: 'A video', author_name: 'An artist' }) }; }, async base => {
    assert.equal((await fetch(`${base}/api/video?id=evil`)).status, 400);
    assert.equal(requests.length, 0);
    const result = await (await fetch(`${base}/api/video?id=M7lc1UVf-VE`)).json();
    assert.deepEqual(result, { id: 'M7lc1UVf-VE', title: 'A video', author: 'An artist' });
    assert.equal(requests[0].origin, 'https://www.youtube.com');
    assert.equal(requests[0].searchParams.get('url'), 'https://www.youtube.com/watch?v=M7lc1UVf-VE');
  });
});
test('failed title lookups produce a recoverable error while the app still serves', async () => {
  await withServer(async () => { throw new Error('Offline'); }, async base => {
    const response = await fetch(`${base}/api/video?id=HyHNuVaZJ-k`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /still add and play/);
    assert.equal((await fetch(base)).status, 200);
  });
});
test('version lookup validates IDs, caches provider results, and returns recoverable errors', async () => {
  let calls = 0;
  await withServer(async (_url, options) => {
    calls++;
    return options.method ? Response.json({}) : new Response('ytcfg.set({"INNERTUBE_CLIENT_VERSION":"1.test"});');
  }, async base => {
    assert.equal((await fetch(`${base}/api/track-versions?id=invalid`)).status, 400);
    assert.equal(calls, 0);
    for (let index = 0; index < 2; index++) {
      const response = await fetch(`${base}/api/track-versions?id=9mWr4c_ig54`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { versions: {} });
    }
    assert.equal(calls, 2);
  });
  await withServer(async () => { throw new Error('Offline'); }, async base => {
    const response = await fetch(`${base}/api/track-versions?id=9mWr4c_ig54`);
    assert.equal(response.status, 502);
    assert.match((await response.json()).error, /Try again/);
    assert.equal((await fetch(base)).status, 200);
  });
});
test('playlist listing fallback validates its ID and fetches only the public YouTube listing', async () => {
  const requests = [];
  await withServer(async url => { requests.push(url); return { ok: true, text: async () => playlistPage([{ lockupViewModel: { contentId: 'c8fu7tkc2Iw', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', metadata: { lockupMetadataViewModel: { title: { content: 'First' } } } } }]) }; }, async base => {
    assert.equal((await fetch(`${base}/api/playlist?id=https://evil.test`)).status, 400);
    assert.equal(requests.length, 0);
    const response = await fetch(`${base}/api/playlist?id=PL_public`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).tracks[0].id, 'c8fu7tkc2Iw');
    assert.equal(requests[0].origin, 'https://www.youtube.com');
    assert.equal(requests[0].pathname, '/playlist');
  });
});
