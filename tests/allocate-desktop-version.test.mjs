import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';

const nativeShell = { skip: process.platform === 'win32' ? 'POSIX executable fixture' : false };
async function allocate(t, branch, collide = false) {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin'); await mkdir(bin);
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'electron'));
  for (const file of ['scripts/allocate-desktop-version.mjs', 'scripts/desktop-version.mjs', 'electron/versions.mjs']) await copyFile(file, join(root, file));
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.2.0' }));
  await writeFile(join(root, 'state.json'), JSON.stringify({ tags: ['desktop-v1.2.8'], collide, writes: [] }));
  await writeFile(join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const file = path.join(process.env.VERSION_FIXTURE, 'state.json');
const state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2);
if (args.includes('POST')) {
 const ref = args.find(arg => arg.startsWith('ref=')).slice('ref=refs/tags/'.length);
 state.tags.push(ref); state.writes.push(ref);
 const collision = state.collide; state.collide = false;
 fs.writeFileSync(file, JSON.stringify(state));
 if (collision) { console.error('HTTP 422: reference exists'); process.exit(1); }
 console.log('{}');
} else if (args.some(arg => arg.includes('/tags?'))) console.log(state.tags.join('\\n'));
else if (args.some(arg => arg.includes('/releases?'))) console.log('1.2.8 · Build 8.1');
else process.exit(1);
`, { mode: 0o755 });
  const before = await readFile('package.json', 'utf8');
  const output = join(root, 'output');
  const result = spawnSync(process.execPath, [join(root, 'scripts/allocate-desktop-version.mjs')], { encoding: 'utf8', env: {
    ...process.env, GH_REPO: 'fixture/yinamp', GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: branch,
    GITHUB_RUN_NUMBER: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_OUTPUT: output, VERSION_FIXTURE: root, PATH: `${bin}${delimiter}${process.env.PATH}`,
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile('package.json', 'utf8'), before);
  return { output: await readFile(output, 'utf8'), state: JSON.parse(await readFile(join(root, 'state.json'), 'utf8')) };
}

test('CI emits one shared version without editing source and retries an atomic ref collision', nativeShell, async t => {
  const { output, state } = await allocate(t, 'main', true);
  assert.equal(output, 'version=1.2.10\n');
  assert.deepEqual(state.writes, ['desktop-v1.2.9', 'desktop-v1.2.10']);
});

test('CI branches reserve prereleases without consuming the next main patch', nativeShell, async t => {
  const { output, state } = await allocate(t, 'codex/my-feature');
  assert.equal(output, 'version=1.2.9-codex-my-feature.123.1\n');
  assert.deepEqual(state.writes, ['desktop-v1.2.9-codex-my-feature.123.1']);
});
