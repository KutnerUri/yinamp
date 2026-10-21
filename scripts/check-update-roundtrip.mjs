// Manual native integration check: node scripts/check-update-roundtrip.mjs <executable> <app.asar>
// Uses only a temporary profile and synthetic local builds; does not publish or change real user data.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { UpdateStore, RELEASES, digest } from '../electron/update-store.mjs';

const [executable, archive] = process.argv.slice(2).map(value => resolve(value));
if (!executable || !archive) throw new Error('Supply the packaged executable and archive');
const directory = await mkdtemp(join(tmpdir(), 'yinamp-update-roundtrip-'));
const userData = join(directory, 'profile');
await mkdir(userData);
const bundled = JSON.parse(await readFile(new URL('../build-info.json', import.meta.url), 'utf8'));
const options = { directory: join(userData, 'updates'), userData, bundled, bundledRoot: archive, electron: bundled.electron, platform: `${process.platform}-${process.arch}` };
const makeManifest = (number, bytes) => ({ protocol: 1, id: `build-90000000${number}-1`, number, attempt: 1, commit: 'a'.repeat(40), version: '1.2.0', electron: bundled.electron, payloads: { [options.platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/build-90000000${number}-1/Yinamp-${options.platform}.asar` } } });
let running;
const log = await open(join(directory, 'process.log'), 'a');
async function stop() {
  const diagnostics = await readFile(join(userData, 'yinamp-diagnostics.jsonl'), 'utf8').catch(() => '');
  const pids = diagnostics.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item => item.event === 'startup').map(item => item.pid);
  for (const pid of new Set([running?.pid, ...pids])) {
    if (pid) try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  await new Promise(resolve => setTimeout(resolve, 500));
}
async function launchUntil(id, failed) {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  running = spawn(executable, [`--profile=${userData}`], { env: environment, stdio: ['ignore', log.fd, log.fd] });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const store = await new UpdateStore(options).load();
    if (store.state.active === id && store.state.launch?.healthy && (!failed || store.state.failed.includes(failed))) return store;
  }
  throw new Error(`Build did not become healthy. Logs: ${directory}\n${await readFile(join(directory, 'process.log'), 'utf8')}`);
}
try {
  const goodBytes = await readFile(archive);
  const good = makeManifest(9001, goodBytes);
  let store = await new UpdateStore(options).load();
  await store.begin(); await store.cleanExit(); await store.stage(good, goodBytes);
  store = await launchUntil(good.id);
  console.log('PASS: downloaded ASAR launched and confirmed renderer health');
  await stop();
  store = await new UpdateStore(options).load();
  await store.rollback();
  store = await launchUntil(bundled.id);
  assert.equal(store.state.pinned, bundled.id);
  console.log('PASS: manual rollback launched and pinned the bundled application');
  await stop();
  const fixture = join(directory, 'broken'); await mkdir(join(fixture, 'electron'), { recursive: true });
  await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
  await writeFile(join(fixture, 'electron/main.mjs'), 'throw new Error("Deliberate startup failure for updater integration test");');
  const builderRequire = createRequire(import.meta.resolve('electron-builder'));
  const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  await libRequire('@electron/asar').createPackage(fixture, join(directory, 'broken.asar'));
  const badBytes = await readFile(join(directory, 'broken.asar'));
  const bad = makeManifest(9002, badBytes);
  store = await new UpdateStore(options).load(); await store.stage(bad, badBytes, { pin: true });
  store = await launchUntil(bundled.id, bad.id);
  console.log('PASS: a broken downloaded application was rejected and automatically relaunched the fallback');
  console.log(`Isolated profile and logs: ${directory}`);
} finally {
  await stop(); await log.close();
}
