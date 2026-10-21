// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';
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
