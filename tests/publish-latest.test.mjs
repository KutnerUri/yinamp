import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { digest, RELEASES } from '../electron/update-store.mjs';

async function fixture(t, badRuntime = false) {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); await mkdir(bin);
  const metadata = { protocol: 1, id: 'build-123-1', number: 12, attempt: 1, commit: 'a'.repeat(40), version: '1.2.0', electron: '44.7.0' };
  for (const platform of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64']) {
    const bytes = Buffer.from(`app-${platform}`);
    const runtime = { version: '44.7.0', revision: '2', size: 123, sha256: 'c'.repeat(64), url: badRuntime ? 'https://example.com/runtime.zip' : `https://github.com/electron/electron/releases/download/v44.7.0/electron-v44.7.0-${platform}.zip` };
    await writeFile(join(root, `Yinamp-${platform}.asar`), bytes);
    await writeFile(join(root, `${platform}.update.json`), JSON.stringify({ ...metadata, payloads: { [platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/${metadata.id}/Yinamp-${platform}.asar`, runtime } } }));
  }
  for (const name of ['mac-arm64.dmg', 'mac-x64.dmg', 'win-x64.exe', 'linux-x64.AppImage']) await writeFile(join(root, `Yinamp-latest-${name}`), 'installer');
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);const root=process.env.PUBLISH_FIXTURE;
fs.appendFileSync(path.join(root,'commands.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='api'&&args[1].includes('/commits/main')){console.log('a'.repeat(40));process.exit(0)}
if(args[0]==='release'&&args[1]==='view')process.exit(1);
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [resolve('scripts/publish-latest.mjs'), root], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'fixture-only', GH_REPO: 'KutnerUri/yinamp', GITHUB_SHA: metadata.commit, PUBLISH_FIXTURE: root, PATH: `${bin}${delimiter}${process.env.PATH}` } });
  const log = await readFile(join(root, 'commands.jsonl'), 'utf8').catch(() => '');
  return { result, commands: log.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}
const nativeShell = { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false };
test('app publishing needs no hosted Electron archives or runtime releases', nativeShell, async t => {
  const { result, commands } = await fixture(t);
  assert.equal(result.status, 0, result.stderr);
  const appCreate = commands.findIndex(args => args[1] === 'create' && args[2] === 'build-123-1');
  const feedCreate = commands.findIndex(args => args[1] === 'create' && args[2] === 'latest-build');
  assert.ok(appCreate >= 0 && appCreate < feedCreate);
  assert.equal(commands.some(args => args.some(arg => arg.startsWith('runtime-') || arg.endsWith('.zip'))), false);
});
test('publishing rejects nonofficial runtime URLs before any release mutation', nativeShell, async t => {
  const { result, commands } = await fixture(t, true);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /Invalid runtime/);
  assert.equal(commands.some(args => ['upload', 'edit', 'create'].includes(args[1])), false);
});
