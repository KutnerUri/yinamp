// Desktop lifecycle tests: node tests/desktop/lifecycle.mjs <executable> <app.asar>
// Uses only a temporary profile and synthetic local builds; does not publish or change real user data.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, open, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { UpdateStore, RELEASES, digest } from '../../electron/update-store.mjs';

const [executable, archive] = process.argv.slice(2).map(value => resolve(value));
if (!executable || !archive) throw new Error('Supply the packaged executable and archive');
const directory = process.env.YINAMP_UPDATE_TEST_OUTPUT ? resolve(process.env.YINAMP_UPDATE_TEST_OUTPUT) : await mkdtemp(join(tmpdir(), 'yinamp-update-roundtrip-'));
await mkdir(directory, { recursive: true });
const userData = await mkdtemp(join(directory, 'profile-'));
const builderRequire = createRequire(import.meta.resolve('electron-builder'));
const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = libRequire('@electron/asar');
const bundled = JSON.parse(asar.extractFile(archive, 'build-info.json').toString('utf8'));
const options = { directory: join(userData, 'updates'), userData, bundled, bundledRoot: archive, electron: bundled.electron, platform: `${process.platform}-${process.arch}` };
const makeManifest = (number, bytes) => ({ protocol: 1, id: `build-90000000${number}-1`, number, attempt: 1, commit: 'a'.repeat(40), version: bundled.version, electron: bundled.electron, payloads: { [options.platform]: { size: bytes.length, sha256: digest(bytes), url: `${RELEASES}/download/build-90000000${number}-1/Yinamp-${options.platform}.asar` } } });
const firstNumber = Math.max(9001, bundled.number + 1);
let running, spawnError, phaseStartedAt = 0;
const report = { platform: options.platform, bundled: bundled.id, passed: [], startedAt: new Date().toISOString() };
const log = await open(join(directory, 'process.log'), 'w');
async function stop() {
  const diagnostics = await readFile(join(userData, 'yinamp-diagnostics.jsonl'), 'utf8').catch(() => '');
  const starts = diagnostics.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).filter(item => item.event === 'startup' && Date.parse(item.time) >= phaseStartedAt);
  const pids = new Set([running && running.exitCode === null && running.signalCode === null ? running.pid : null, starts.at(-1)?.pid].filter(Boolean));
  for (const pid of pids) {
    if (pid) try { process.kill(pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const alive = [...pids].some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } });
    if (!alive) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Isolated app process did not stop in time');
}
async function launchUntil(id, failed) {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  phaseStartedAt = Date.now(); spawnError = null;
  // Ubuntu CI's user-namespace policy blocks Chromium's sandbox. This flag applies
  // only to the isolated test process, never the distributed application or launcher.
  const testArgs = process.env.CI === 'true' && process.platform === 'linux' ? ['--no-sandbox'] : [];
  running = spawn(executable, [`--profile=${userData}`, ...testArgs], { env: environment, stdio: ['ignore', log.fd, log.fd] });
  running.on('error', error => { spawnError = error; });
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (spawnError) throw spawnError;
    const store = await new UpdateStore(options).load();
    const diagnostics = await readFile(join(userData, 'yinamp-diagnostics.jsonl'), 'utf8').catch(() => '');
    const freshStartup = diagnostics.split('\n').some(line => { try { const item = JSON.parse(line); return item.event === 'startup' && Date.parse(item.time) >= phaseStartedAt; } catch { return false; } });
    if (freshStartup && store.state.active === id && store.state.launch?.healthy && (!failed || store.state.failed.includes(failed))) return store;
  }
  throw new Error(`Build did not become healthy. Logs: ${directory}\n${await readFile(join(directory, 'process.log'), 'utf8')}`);
}
async function pass(message) {
  report.passed.push(message);
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${message}`);
}
try {
  const goodBytes = await readFile(archive);
  const good = makeManifest(firstNumber, goodBytes);
  let store = await new UpdateStore(options).load();
  await store.begin(); await store.cleanExit(); await store.pause(true);
  store = await launchUntil(bundled.id);
  await pass('packaged application started and confirmed renderer health');
  await stop();
  store = await new UpdateStore(options).load();
  await store.stage(good, goodBytes);
  store = await launchUntil(good.id);
  await pass('downloaded ASAR launched and confirmed renderer health');
  await stop();
  store = await new UpdateStore(options).load();
  await store.rollback();
  store = await launchUntil(bundled.id);
  assert.equal(store.state.pinned, bundled.id);
  await pass('manual rollback launched and pinned the bundled application');
  await stop();
  const fixture = join(directory, 'broken'); await mkdir(join(fixture, 'electron'), { recursive: true });
  await writeFile(join(fixture, 'package.json'), '{"type":"module"}');
  await writeFile(join(fixture, 'electron/main.mjs'), 'throw new Error("Deliberate startup failure for updater integration test");');
  await asar.createPackage(fixture, join(directory, 'broken.asar'));
  const badBytes = await readFile(join(directory, 'broken.asar'));
  const bad = makeManifest(firstNumber + 1, badBytes);
  store = await new UpdateStore(options).load(); await store.stage(bad, badBytes, { pin: true });
  store = await launchUntil(bundled.id, bad.id);
  await pass('a broken downloaded application was rejected and automatically relaunched the fallback');
  console.log(`Isolated profile and logs: ${directory}`);
} catch (error) {
  report.error = error.stack || String(error);
  throw error;
} finally {
  report.finishedAt = new Date().toISOString();
  try { await stop(); } catch (error) { report.cleanupError = error.message; process.exitCode = 1; }
  await log.close();
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  for (const [source, destination] of [
    [join(userData, 'updates/state.json'), 'update-state.json'],
    [join(userData, 'yinamp-diagnostics.jsonl'), 'startup-diagnostics.jsonl'],
  ]) {
    try { await copyFile(source, join(directory, destination)); } catch { /* Preserve diagnostics that exist. */ }
  }
}
