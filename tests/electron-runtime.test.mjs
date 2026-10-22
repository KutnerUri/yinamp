import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { electronFilename, electronChecksum, officialElectron, ELECTRON_RELEASES } from '../scripts/electron-runtime.mjs';
import { digest } from '../electron/update-store.mjs';

test('official Electron assets use exact versions and supported targets', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64']]) assert.equal(electronFilename('44.7.0', platform, arch), `electron-v44.7.0-${platform}-${arch}.zip`);
  for (const args of [['../bad', 'darwin', 'arm64'], ['44.7.0', 'linux', 'arm64'], ['44.7.0', 'win32', 'x86']]) assert.throws(() => electronFilename(...args), /Unsupported/);
});
test('official checksum parsing rejects missing or ambiguous entries', () => {
  const filename = 'electron-v44.7.0-darwin-arm64.zip'; const hash = 'a'.repeat(64);
  assert.equal(electronChecksum(`${hash} *${filename}\r\n${'b'.repeat(64)}  other.zip\n`, filename), hash);
  assert.throws(() => electronChecksum(`${hash} *other.zip`, filename), /Missing/);
  assert.throws(() => electronChecksum(`${hash} *${filename}\n${hash} *${filename}`, filename), /ambiguous/);
  assert.throws(() => electronChecksum('x'.repeat(1024 * 1024 + 1), filename), /large/);
});
test('builds verify official bytes and cannot inherit a custom mirror URL', async t => {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-official-electron-')); t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, 'electron.zip'); const bytes = Buffer.from('official archive fixture'); await writeFile(archive, bytes);
  const sha256 = digest(bytes); const filename = electronFilename('44.7.0', 'darwin', 'arm64'); let options;
  const parameters = { version: '44.7.0', platform: 'darwin', arch: 'arm64', fetcher: async url => { assert.equal(url, `${ELECTRON_RELEASES}v44.7.0/SHASUMS256.txt`); return { ok: true, text: async () => `${sha256} *${filename}` }; }, downloader: async value => { options = value; return archive; } };
  const result = await officialElectron(parameters);
  assert.equal(result.runtime.url, `${ELECTRON_RELEASES}v44.7.0/${filename}`);
  assert.equal(result.runtime.sha256, sha256); assert.equal(result.runtime.size, bytes.length);
  assert.equal(options.mirrorOptions.mirror, ELECTRON_RELEASES);
  assert.equal(await options.mirrorOptions.resolveAssetURL(), result.runtime.url);
  assert.deepEqual(options.checksums, { [filename]: sha256 });
  await writeFile(archive, 'corrupt archive');
  await assert.rejects(officialElectron(parameters), /integrity/);
});
