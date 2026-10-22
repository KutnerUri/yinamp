import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { UpdateStore, createDevelopmentUpdateStore, digest, RELEASES, validateManifest, newer, mergeManifests } from '../electron/update-store.mjs';
import { githubDownload, readManifest } from '../electron/update-network.mjs';
import { UPDATE_DAY_MS, MIN_UPDATE_DELAY_MS, MAX_UPDATE_DELAY_MS, nextUpdateCheck } from '../electron/update-schedule.mjs';

const bytes = Buffer.from('a test application archive');
const platform = 'darwin-arm64';
function manifest(number = 2, electron = '44.7.0') {
  const id = `build-${1000 + number}-1`;
  return { protocol: 1, id, number, attempt: 1, commit: 'a'.repeat(40), version: '1.2.0', electron, payloads: { [platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/${id}/Yinamp-${platform}.asar` } } };
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'yinamp-updates-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, userData: directory, bundled: { ...manifest(1), payloads: undefined }, bundledRoot: '/bundled/app.asar', platform, electron: '44.7.0' };
  const open = async () => new UpdateStore(options).load();
  return { store: await open(), open, directory };
}

test('staging never changes the running app; restart promotes only after a verified download', async t => {
  const { store, open } = await fixture(t);
  assert.equal(await store.begin(), '/bundled/app.asar');
  await store.healthy(); await store.cleanExit();
  await store.stage(manifest(), bytes, { automatic: true });
  assert.equal(store.state.active, store.bundled.id);
  assert.equal(store.state.pending, manifest().id);
  const restarted = await open();
  assert.equal(await restarted.begin(), store.archive(manifest().id));
  assert.equal(restarted.state.previous, store.bundled.id);
  assert.equal(restarted.state.launch.healthy, false);
  await restarted.healthy(); await restarted.cleanExit();
  const next = await open();
  assert.equal(await next.begin(), store.archive(manifest().id));
});

test('a failed startup restores the previous app and its settings snapshot', async t => {
  const { store, open, directory } = await fixture(t);
  const statePath = join(directory, 'yinamp-state.json');
  await writeFile(statePath, 'original queue');
  await store.begin(); await store.cleanExit(); await store.stage(manifest(), bytes);
  const trial = await open(); await trial.begin();
  await writeFile(statePath, 'broken migration');
  const recovered = await open();
  assert.equal(await recovered.begin(), '/bundled/app.asar');
  assert.equal(await readFile(statePath, 'utf8'), 'original queue');
  assert.ok(recovered.state.failed.includes(manifest().id));
  assert.equal(await recovered.stage(manifest(), bytes, { automatic: true }), false);
});

test('two unclean launches after healthy startup roll back; clean exits reset the counter', async t => {
  const { store, open } = await fixture(t);
  await store.begin(); await store.cleanExit(); await store.stage(manifest(), bytes);
  const first = await open(); await first.begin(); await first.healthy();
  const second = await open(); await second.begin(); await second.healthy();
  assert.equal(second.state.active, manifest().id);
  const third = await open(); await third.begin();
  assert.equal(third.state.active, store.bundled.id);
});

test('paused or pinned builds do not automatically download or activate an unwanted update', async t => {
  const { store } = await fixture(t);
  await store.begin(); await store.lock(true);
  assert.equal(await store.stage(manifest(), bytes, { automatic: true }), false);
  await store.lock(false); await store.pause(true);
  assert.equal(await store.stage(manifest(), bytes, { automatic: true }), false);
  await store.stage(manifest(), bytes, { pin: true });
  assert.equal(store.state.pinned, manifest().id);
  assert.equal(await store.begin(), store.archive(manifest().id));
});

test('locking the running version cancels a staged automatic update', async t => {
  const { store, open } = await fixture(t);
  await store.begin(); await store.stage(manifest(), bytes); await store.lock(true); await store.cleanExit();
  const next = await open();
  assert.equal(await next.begin(), '/bundled/app.asar');
  assert.equal(next.state.pending, null);
});

test('the automatic-updates toggle cancels staged builds and resumes without a version pin', async t => {
  const { store } = await fixture(t);
  await store.begin(); await store.stage(manifest(), bytes);
  await store.automatic(false);
  assert.equal(store.state.pending, null);
  assert.equal(store.state.pinned, store.state.active);
  assert.equal(store.state.paused, true);
  await store.stage(manifest(), bytes, { pin: true });
  await store.automatic(true);
  assert.equal(store.state.pending, null);
  assert.equal(store.state.pinned, null);
  assert.equal(store.state.paused, false);
  assert.equal(await store.stage(manifest(), bytes, { automatic: true }), true);
});

test('specific-version selection works offline for current and cached builds and disables automatic updates', async t => {
  const { store } = await fixture(t);
  await store.begin(); await store.stage(manifest(), bytes);
  assert.equal(await store.select(store.state.active), true);
  assert.equal(store.state.pending, null);
  assert.equal(store.state.paused, true);
  assert.equal(await store.select(manifest().id), true);
  assert.equal(store.state.pending, manifest().id);
  assert.equal(store.state.pinned, manifest().id);
  assert.equal(await store.select('build-999999-1'), false);
  assert.equal(store.state.pending, manifest().id);
});

test('rollback selects and pins the actual previous build, including the bundled app', async t => {
  const { store, open } = await fixture(t);
  await store.begin(); await store.cleanExit(); await store.stage(manifest(), bytes);
  const trial = await open(); await trial.begin(); await trial.healthy();
  await trial.rollback(); await trial.cleanExit();
  const reverted = await open();
  assert.equal(await reverted.begin(), '/bundled/app.asar');
  assert.equal(reverted.state.pinned, store.bundled.id);
});

test('bad checksums, incompatible runtimes and tampered cached archives cannot run', async t => {
  const { store, open } = await fixture(t);
  await store.begin(); await store.cleanExit();
  await assert.rejects(store.stage(manifest(), Buffer.from('corrupt')), /integrity/);
  await assert.rejects(store.stage(manifest(3, '45.0.0'), bytes), /newer desktop/);
  await store.stage(manifest(), bytes);
  await writeFile(store.archive(manifest().id), 'tampered');
  const next = await open();
  assert.equal(await next.begin(), '/bundled/app.asar');
  assert.ok(next.state.failed.includes(manifest().id));
});

test('damaged update state falls back to the bundled app', async t => {
  const { directory, open } = await fixture(t);
  await writeFile(join(directory, 'state.json'), '{partial');
  const next = await open();
  assert.equal(await next.begin(), '/bundled/app.asar');
});

test('a fresh manual install takes precedence over older automatic updates', async t => {
  const { store, open } = await fixture(t);
  await store.begin(); await store.cleanExit(); await store.stage(manifest(), bytes);
  const next = await open(); await next.begin(); await next.healthy(); await next.cleanExit();
  next.bundled = { ...manifest(5), payloads: undefined };
  assert.equal(await next.begin(), '/bundled/app.asar');
  assert.equal(next.state.active, manifest(5).id);
});

test('manifest validation fixes the repository, immutable build and asset paths', () => {
  assert.equal(validateManifest(manifest()).id, manifest().id);
  for (const url of ['https://evil.example/code.asar', `${RELEASES}/download/latest-build/Yinamp-${platform}.asar`]) {
    const bad = structuredClone(manifest()); bad.payloads[platform].url = url;
    assert.throws(() => validateManifest(bad));
  }
  assert.throws(() => validateManifest({ ...manifest(), id: '../../escape' }));
  assert.equal(newer({ number: 2, attempt: 2 }, { number: 2, attempt: 1 }), true);
  assert.equal(newer({ number: 1, attempt: 5 }, { number: 2, attempt: 1 }), false);
});

test('update networking accepts only the project and GitHub asset redirects', async () => {
  let requests = 0;
  const url = manifest().payloads[platform].url;
  const result = await githubDownload(url, { fetcher: async () => ++requests === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } }) : new Response(bytes) });
  assert.deepEqual(result, bytes);
  await assert.rejects(githubDownload('https://evil.example/file', { fetcher: async () => { throw new Error('must not fetch'); } }), /source/);
  await assert.rejects(githubDownload(url, { fetcher: async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/file' } }) }), /redirect/);
  await assert.rejects(githubDownload(url, { limit: 2, fetcher: async () => new Response(bytes) }), /too large/);
  await assert.rejects(githubDownload(url, { fetcher: async () => new Response('unavailable', { status: 503 }) }), /503/);
});

test('offline checks and malformed manifests are recoverable errors', async () => {
  await assert.rejects(readManifest('latest-build', { fetcher: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(readManifest('latest-build', { fetcher: async () => new Response('{}') }), /Unsupported/);
});

test('publishing merges all four matching platform builds and rejects partial or mixed runs', () => {
  const fragments = ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].map(platform => {
    const value = manifest();
    value.payloads = { [platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/${value.id}/Yinamp-${platform}.asar` } };
    return value;
  });
  assert.equal(Object.keys(mergeManifests(fragments, 'a'.repeat(40)).payloads).length, 4);
  assert.throws(() => mergeManifests(fragments.slice(0, 3), 'a'.repeat(40)), /four/);
  assert.throws(() => mergeManifests([...fragments.slice(0, 3), fragments[0]], 'a'.repeat(40)), /Incomplete/);
  assert.throws(() => mergeManifests(fragments, 'b'.repeat(40)), /commit/);
  const mixed = structuredClone(fragments); mixed[3].number++;
  assert.throws(() => mergeManifests(mixed, 'a'.repeat(40)), /different/);
});

test('automatic checks are jittered and the planned time survives restarts', async t => {
  const { store, open } = await fixture(t);
  const now = 1700000000000;
  const planned = await store.scheduleCheck(now, () => 0.5);
  assert.ok(planned >= now + MIN_UPDATE_DELAY_MS && planned <= now + MAX_UPDATE_DELAY_MS);
  const restarted = await open();
  assert.equal(await restarted.scheduleCheck(now + 1000, () => 0.99), planned);
  assert.equal(await restarted.claimCheck({ now: planned - 1 }), false);
  assert.equal(await restarted.claimCheck({ now: planned, random: () => 0 }), true);
});

test('failed automatic attempts count for the daily limit across restarts', async t => {
  const { store, open } = await fixture(t);
  const now = 1700000000000;
  assert.equal(await store.claimCheck({ now, random: () => 0 }), true);
  await assert.rejects(readManifest('latest-build', { fetcher: async () => { throw new Error('offline'); } }), /offline/);
  const restarted = await open();
  assert.equal(restarted.state.lastCheckAt, now);
  assert.equal(await restarted.claimCheck({ now: now + 60 * 60 * 1000 }), false);
  assert.equal(await restarted.claimCheck({ now: now + UPDATE_DAY_MS }), false);
  assert.equal(await restarted.claimCheck({ now: now + UPDATE_DAY_MS + MIN_UPDATE_DELAY_MS, random: () => 0 }), true);
});

test('manual checks stay available and postpone automatic checks without a retry burst', async t => {
  const { store, open } = await fixture(t);
  const now = 1700000000000;
  assert.equal(await store.claimCheck({ manual: true, now, random: () => 0 }), true);
  assert.equal(await store.claimCheck({ manual: true, now: now + 1000, random: () => 0 }), true);
  await store.automatic(false); await store.automatic(true);
  const restarted = await open();
  assert.equal(await restarted.claimCheck({ now: now + UPDATE_DAY_MS }), false);
  assert.equal(await restarted.scheduleCheck(now + 2000, () => 0.99), now + 1000 + UPDATE_DAY_MS + MIN_UPDATE_DELAY_MS);
});

test('an overdue appointment gets startup jitter rather than an immediate GitHub request', () => {
  const now = 1700000000000;
  assert.equal(nextUpdateCheck(now - 2 * UPDATE_DAY_MS, now - UPDATE_DAY_MS, now, () => 0), now + MIN_UPDATE_DELAY_MS);
});

test('development preview only permits explicit checks and has no install or persistence capabilities', async () => {
  const store = createDevelopmentUpdateStore({ version: '1.2.0', electron: '44.7.0', platform });
  assert.equal(store.metadata().version, '1.2.0');
  assert.equal(store.metadata(null), undefined);
  assert.equal(store.state.paused, true);
  assert.equal(await store.claimCheck(), false);
  assert.equal(await store.claimCheck({ manual: true }), true);
  assert.equal(store.stage, undefined);
  assert.equal(store.select, undefined);
  assert.equal(store.automatic, undefined);
  assert.equal(store.archive, undefined);
  assert.equal(store.directory, undefined);
  await store.save();
  assert.equal(store.state.pending, null);
});

test('a managed launcher stages a different Electron version and hands it off before a trial starts', async t => {
  const { store, directory } = await fixture(t);
  store.runtimeManaged = true;
  await store.begin(); await store.healthy(); await store.cleanExit();
  const next = manifest(2, '45.0.0');
  next.payloads[platform].runtime = { version: next.electron, revision: '2', size: 123, sha256: 'c'.repeat(64), url: `https://github.com/electron/electron/releases/download/v45.0.0/electron-v45.0.0-${platform}.zip` };
  await store.stage(next, bytes);
  let requested;
  await assert.rejects(store.begin({ ensureRuntime: async metadata => { requested = metadata; throw new Error('runtime handoff'); } }), /runtime handoff/);
  assert.equal(requested.id, next.id);
  assert.equal(store.state.active, next.id);
  assert.equal(store.state.launch, null, 'switching runtimes is not an unhealthy launch');
  assert.equal(store.state.previous, store.bundled.id);
  const restarted = new UpdateStore({ ...store, directory, electron: '45.0.0' });
  await restarted.load();
  assert.equal(await restarted.begin(), store.archive(next.id));
  assert.deepEqual(restarted.state.failed, []);
  await restarted.reject(next.id, true);
  assert.equal(restarted.state.active, store.bundled.id, 'rollback crosses runtime versions');
});

test('runtime packages are pinned to the exact official Electron release and bounded', () => {
  const value = manifest();
  value.payloads[platform].runtime = { version: value.electron, revision: '2', size: 123, sha256: 'c'.repeat(64), url: `https://github.com/electron/electron/releases/download/v${value.electron}/electron-v${value.electron}-${platform}.zip` };
  assert.equal(validateManifest(value), value);
  for (const change of [{ url: 'https://evil.example/runtime.zip' }, { version: '45.0.0' }, { revision: '3' }, { size: 400 * 1024 * 1024 }, { sha256: 'broken' }]) {
    const bad = structuredClone(value); Object.assign(bad.payloads[platform].runtime, change);
    assert.throws(() => validateManifest(bad), /runtime/);
  }
});

test('a failed runtime download restores the working app without blacklisting a retry', async t => {
  const { store, directory } = await fixture(t);
  const statePath = join(directory, 'yinamp-state.json');
  await writeFile(statePath, 'original queue');
  store.runtimeManaged = true;
  await store.begin(); await store.healthy(); await store.cleanExit();
  await store.stage(manifest(), bytes);
  await store.begin();
  await writeFile(statePath, 'recent queue');
  await store.runtimeUnavailable();
  assert.equal(await readFile(statePath, 'utf8'), 'recent queue');
  assert.equal(store.state.active, store.bundled.id);
  assert.equal(store.state.pending, null);
  assert.equal(store.state.failed.includes(manifest().id), false);
});
