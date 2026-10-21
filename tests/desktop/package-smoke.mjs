// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = pathToFileURL(resolve(process.argv[2]) + '/');
const metadata = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
await readFile(new URL('electron/preload.cjs', root));
const { createAppServer } = await import(new URL('server.mjs', root));
const server = createAppServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/src/app.js', '/src/styles.css', '/src/app-icon.png', '/skins/classic.json', '/src/vendor/signals-core.js']) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, `${path} must be bundled`);
    if (path.endsWith('.png')) {
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      continue;
    }
    const body = await response.text();
    assert.ok(body.length > 0, `${path} must not be empty`);
    if (path === '/') assert.ok(body.includes(`v${metadata.version}`), 'Displayed version must match the package');
  }
  console.log(`Packaged Yinamp ${metadata.version}: server, UI, skin, preload and runtime dependency passed.`);
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

// Exercise raw archive I/O inside Electron on every build platform, not just Node's filesystem.
const { UpdateStore, digest, RELEASES } = await import(new URL('electron/update-store.mjs', root));
const rawFS = createRequire(import.meta.url)('original-fs').promises;
const bytes = await rawFS.readFile(resolve(process.argv[2]));
const directory = await mkdtemp(join(tmpdir(), 'yinamp-packaged-update-'));
try {
  const bundled = JSON.parse(await readFile(new URL('build-info.json', root), 'utf8'));
  const platform = `${process.platform}-${process.arch}`;
  const manifest = { protocol: 1, id: 'build-900000001-1', number: 999999, attempt: 1, commit: 'a'.repeat(40), version: metadata.version, electron: process.versions.electron,
    payloads: { [platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/build-900000001-1/Yinamp-${platform}.asar` } } };
  const store = await new UpdateStore({ directory, bundled, bundledRoot: resolve(process.argv[2]), electron: process.versions.electron, platform }).load();
  await store.begin(); await store.cleanExit(); await store.stage(manifest, bytes);
  assert.equal(await store.begin(), store.archive(manifest.id));
  assert.equal(await store.verify(manifest.id), true);
  await store.healthy(); await store.rollback(); await store.cleanExit();
  assert.equal(await store.begin(), resolve(process.argv[2]));
  console.log('Packaged updater: archive integrity, staging, activation and rollback passed.');
} finally {
  await rawFS.rm(directory, { recursive: true, force: true });
}
