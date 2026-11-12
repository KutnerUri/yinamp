import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const nativeShell = { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false };
const releases = [
  { tag: 'build-15-1', name: '1.2.20-universal-dmg.15.1 · Build 15.1', prerelease: true },
  { tag: 'build-14-1', name: '1.2.2-universal-dmg.14.1 · Build 14.1', prerelease: true },
  { tag: 'build-10-1', name: '1.2.1 · Build 10.1', prerelease: false },
  { tag: 'latest-build', name: 'Latest build', prerelease: true },
  { tag: 'build-9-1', name: '1.2.1-compact-package.9.1 · Build 9.1', prerelease: true },
  { tag: 'build-8-1', name: '1.2.1-universal-dmg-v2.8.1 · Build 8.1', prerelease: true },
  { tag: 'build-4-1', name: '1.2.0 · Build 4.1', prerelease: true },
];
const tags = ['latest-build', 'desktop-v1.2.2-universal-dmg.14.1', 'desktop-v1.2.1', 'desktop-v1.2.1-compact-package.9.1', 'build-15-1'];

async function cleanup(t, branch) {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-cleanup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs=require('node:fs');const path=require('node:path');const args=process.argv.slice(2);const root=process.env.CLEANUP_FIXTURE;
if(args[0]==='api'&&args.some(arg=>arg.includes('/releases?'))){for(const r of ${JSON.stringify(releases)})console.log(JSON.stringify(r));process.exit(0)}
if(args[0]==='api'&&args.some(arg=>arg.includes('/tags?'))){console.log(${JSON.stringify(tags.join('\n'))});process.exit(0)}
fs.appendFileSync(path.join(root,'commands.jsonl'),JSON.stringify(args)+'\\n');
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [resolve('scripts/cleanup-previews.mjs'), branch], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: 'fixture-only', GH_REPO: 'KutnerUri/yinamp', CLEANUP_FIXTURE: root, PATH: `${bin}${delimiter}${process.env.PATH}` } });
  const log = await readFile(join(root, 'commands.jsonl'), 'utf8').catch(() => '');
  return { result, commands: log.trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
}

test('a deleted branch loses only its own preview releases and old version tags', nativeShell, async t => {
  const { result, commands } = await cleanup(t, 'universal-DMG');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(commands, [
    ['release', 'delete', 'build-15-1', '--yes', '--cleanup-tag'],
    ['release', 'delete', 'build-14-1', '--yes', '--cleanup-tag'],
    ['api', '--method', 'DELETE', 'repos/KutnerUri/yinamp/git/refs/tags/desktop-v1.2.2-universal-dmg.14.1'],
  ], 'a branch with a similar name (universal-dmg-v2), stable releases and latest-build are kept');
});

test('cleanup refuses main and changes nothing', nativeShell, async t => {
  const { result, commands } = await cleanup(t, 'main');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /main branch/);
  assert.deepEqual(commands, []);
});

test('a branch without previews is a no-op', nativeShell, async t => {
  const { result, commands } = await cleanup(t, 'docs-only');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(commands, []);
});
