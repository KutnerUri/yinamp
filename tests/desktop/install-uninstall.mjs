// macOS DMG → copied launcher → bootstrap → running app → cancel → uninstall.
// Control uses the isolated Electron process's loopback Node inspector. Only
// the OS confirmation response is stubbed, through that debugger; production
// code has no test switches or confirmation bypasses.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp, access, rm, open, copyFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { UpdateStore } from '../../electron/update-store.mjs';
import { requireMacOSGUI } from './macos-gui.mjs';

if (process.platform !== 'darwin') throw new Error('This test covers the macOS installer and uninstaller');
const [dmgArg, runtimeArg, archiveArg] = process.argv.slice(2);
if (!dmgArg || !runtimeArg || !archiveArg) throw new Error('Supply <DMG> <verified-runtime-directory> <app.asar>');
await requireMacOSGUI();
const [dmg, runtime, archive] = [dmgArg, runtimeArg, archiveArg].map(value => resolve(value));
const output = resolve(process.env.YINAMP_INSTALL_TEST_OUTPUT || await mkdtemp(join(tmpdir(), 'yinamp-install-report-')));
await mkdir(output, { recursive: true });
const root = await realpath(await mkdtemp(join(output, 'run-')));
const token = basename(root);
const home = join(root, 'home');
const profile = join(home, 'Library', 'Application Support', 'Yinamp');
const installation = join(home, 'Applications', `Yinamp-${token}.app`);
const executable = join(installation, 'Contents', 'MacOS', 'Yinamp');
const mount = join(root, 'mount');
const run = promisify(execFile);
const realHome = homedir();
const report = { platform: `darwin-${process.arch}`, passed: [], startedAt: new Date().toISOString(), coldStart: process.env.YINAMP_INSTALL_COLD_START === '1' };
let running, childPID, launcherPID, inspector, mounted = false;
const log = await open(join(output, 'process.log'), 'w');
const exists = path => access(path).then(() => true, () => false);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, description, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    if (running?.exitCode !== null && running?.exitCode !== undefined) throw new Error(`Launcher exited (${running.exitCode}) while waiting for ${description}`);
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
async function pass(message) {
  report.passed.push(message);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${message}`);
}
async function clone(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  try { await run('/bin/cp', ['-cR', source, destination]); }
  catch { await rm(destination, { recursive: true, force: true }); await cp(source, destination, { recursive: true, verbatimSymlinks: true }); }
}
async function connect(url) {
  const socket = new WebSocket(url);
  await once(socket, 'open');
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const value = JSON.parse(event.data);
    const callback = pending.get(value.id);
    if (!callback) return;
    pending.delete(value.id);
    if (value.error) callback.reject(new Error(value.error.message));
    else callback.resolve(value.result);
  });
  socket.addEventListener('close', () => {
    for (const callback of pending.values()) callback.reject(new Error('Inspector closed'));
    pending.clear();
  });
  return {
    close: () => socket.close(),
    async evaluate(expression) {
      const id = ++sequence;
      const result = await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
  };
}
const builderRequire = createRequire(import.meta.resolve('electron-builder'));
const asar = createRequire(builderRequire.resolve('app-builder-lib'))('@electron/asar');
const bundled = JSON.parse(asar.extractFile(archive, 'build-info.json').toString('utf8'));
let originalPlist, trashReport;
try {
  await mkdir(mount);
  await run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
  mounted = true;
  await clone(join(mount, 'Yinamp.app'), installation);
  originalPlist = await readFile(join(installation, 'Contents', 'Info.plist'));
  await run('/usr/bin/hdiutil', ['detach', mount]);
  mounted = false;
  await pass('DMG mounted and its app installed into a disposable Applications folder');

  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'uninstall-test-marker.json'), JSON.stringify({ token }));
  if (!report.coldStart) {
    const descriptor = JSON.parse(await readFile(join(runtime, 'runtime.json'), 'utf8'));
    assert.equal(descriptor.version, bundled.electron);
    await clone(runtime, join(profile, 'runtimes', `${descriptor.version}-r${descriptor.revision}`));
  }
  const store = await new UpdateStore({ directory: join(profile, 'updates'), userData: profile, bundled, bundledRoot: archive, electron: bundled.electron, platform: report.platform, runtimeManaged: true }).load();
  await store.begin(); await store.cleanExit(); await store.pause(true);

  const environment = { ...process.env, HOME: home, YINAMP_LAUNCHER_NO_UI: '1' };
  delete environment.ELECTRON_RUN_AS_NODE;
  // The launcher derives its normal profile from this temporary HOME. It still
  // applies its production uninstall-path checks; no custom-profile exemption.
  // Optional Finder-style launch; local macOS privacy rules may restrict subsequent Trash inspection.
  running = process.env.YINAMP_INSTALL_LAUNCHSERVICES === '1' ? spawn('/usr/bin/open', ['-n', '-W', '-a', installation,
    '--env', `HOME=${home}`, '--env', 'YINAMP_LAUNCHER_NO_UI=1', '--env', 'ELECTRON_RUN_AS_NODE',
    '--stdout', join(output, 'process.log'), '--stderr', join(output, 'process.log'),
    '--args', '--inspect=127.0.0.1:0'], { env: environment, stdio: ['ignore', log.fd, log.fd] })
    : spawn(executable, ['--inspect=127.0.0.1:0'], { env: environment, stdio: ['ignore', log.fd, log.fd] });
  const exited = new Promise((resolve, reject) => { running.once('exit', (code, signal) => resolve({ code, signal })); running.once('error', reject); });
  const inspectorURL = await waitFor(async () => {
    const text = await readFile(join(profile, 'launcher.log'), 'utf8').catch(() => '');
    return text.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1];
  }, 'the isolated Electron inspector', report.coldStart ? 180000 : 45000);
  inspector = await connect(inspectorURL);
  childPID = await inspector.evaluate('process.pid');
  launcherPID = await inspector.evaluate('process.ppid');
  const electronRequire = `process.getBuiltinModule('module').createRequire(${JSON.stringify(join(resolve('.'), 'package.json'))})('electron')`;
  await inspector.evaluate(`globalThis.__installTestElectron = ${electronRequire}; true`);
  const healthyState = await waitFor(async () => {
    const state = JSON.parse(await readFile(join(profile, 'updates', 'state.json'), 'utf8').catch(() => '{}'));
    return state.launch?.healthy ? state : false;
  }, 'bootstrap and renderer health');
  assert.equal(healthyState.active, bundled.id);
  const status = await inspector.evaluate(`(() => {
    const electron = globalThis.__installTestElectron;
    for (const window of electron.BrowserWindow.getAllWindows()) window.hide();
    const menu = electron.Menu.getApplicationMenu().items.find(item => item.label === 'Yinamp').submenu;
    globalThis.__installTestMenuItem = menu.items.find(item => item.label === 'Uninstall Yinamp…');
    return { available: Boolean(globalThis.__installTestMenuItem?.enabled), profile: electron.app.getPath('userData'), version: electron.app.getVersion(), arch: process.arch };
  })()`);
  assert.equal(status.profile, profile);
  assert.equal(status.version, bundled.version);
  assert.equal(status.arch, process.arch, 'The installed launcher must select the native Electron architecture');
  assert.equal(status.available, true);
  assert.ok(await exists(join(profile, 'launcher')));
  await pass('installed launcher bootstrapped Electron and confirmed renderer health');

  const confirmationStub = join(root, 'confirmation-stub');
  const confirmationLog = join(root, 'confirmation.log');
  await writeFile(confirmationStub, '#!/bin/sh\nprintf "%s\\n" "$YINAMP_TEST_CONFIRMATION" >> "$YINAMP_TEST_CONFIRMATION_LOG"\nprintf "%s\\n" "$YINAMP_TEST_CONFIRMATION"\n', { mode: 0o700 });
  await inspector.evaluate(`process.env.YINAMP_NATIVE_UNINSTALL_HELPER = ${JSON.stringify(confirmationStub)};
    process.env.YINAMP_TEST_CONFIRMATION_LOG = ${JSON.stringify(confirmationLog)};
    process.env.YINAMP_TEST_CONFIRMATION = 'cancel';
    globalThis.__installTestMenuItem.click(); true`);
  await waitFor(async () => (await readFile(confirmationLog, 'utf8').catch(() => '')).includes('cancel'), 'Cancel confirmation response');
  await sleep(500);
  assert.equal(running.exitCode, null);
  assert.equal(await inspector.evaluate('process.pid'), childPID);
  assert.ok(await exists(installation)); assert.ok(await exists(profile));
  await pass('Cancel through the real app menu preserved the installation, profile, and running app');

  const { stdout: processes } = await run('/bin/ps', ['-axo', 'pid=,comm=']);
  const ownedPIDs = processes.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    return match && (match[2].startsWith(installation + '/') || match[2].startsWith(profile + '/')) ? [Number(match[1])] : [];
  });
  assert.ok(ownedPIDs.includes(childPID));
  assert.ok(ownedPIDs.includes(launcherPID));
  await inspector.evaluate(`process.env.YINAMP_TEST_CONFIRMATION = 'uninstall'; setTimeout(() => globalThis.__installTestMenuItem.click(), 100); true`);
  inspector.close(); inspector = null;
  let timer;
  const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Uninstall did not finish')), 20000); })]).finally(() => clearTimeout(timer));
  assert.deepEqual(result, { code: 0, signal: null });
  const deadline = Date.now() + 10000;
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  while (ownedPIDs.some(alive) && Date.now() < deadline) await sleep(100);
  assert.deepEqual(ownedPIDs.filter(alive), [], 'All processes belonging to this disposable installation must exit');
  await pass('app, native launcher, and Electron helpers all exited');
  assert.equal(await exists(installation), false);
  assert.equal(await exists(profile), false);
  const events = (await readFile(join(output, 'process.log'), 'utf8')).split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  trashReport = events.find(event => event.event === 'yinamp-uninstalled');
  assert.ok(trashReport, 'Native helper must report where it moved the installation and profile');
  assert.deepEqual(trashReport.trashed.map(item => item.source).sort(), [installation, profile].sort());
  const profileTrash = trashReport.trashed.find(item => item.source === profile).destination;
  const appTrash = trashReport.trashed.find(item => item.source === installation).destination;
  assert.equal(JSON.parse(await readFile(join(profileTrash, 'uninstall-test-marker.json'), 'utf8')).token, token);
  assert.deepEqual(await readFile(join(appTrash, 'Contents', 'Info.plist')), originalPlist);
  await copyFile(join(profileTrash, 'launcher.log'), join(output, 'launcher.log'));
  await copyFile(join(profileTrash, 'yinamp-diagnostics.jsonl'), join(output, 'startup-diagnostics.jsonl'));
  report.trashed = trashReport.trashed;
  await pass('confirmed uninstall exited Electron and moved both the real app copy and all its local components intact to Trash');

  // Remove only this test's verified trash entries, so repeated tests do not
  // leave a copy of Electron in the user's Trash. Never enumerate or empty it.
  const permittedRoots = await Promise.all([join(realHome, '.Trash'), join(home, '.Trash')].map(path => realpath(path).catch(() => null)));
  for (const item of trashReport.trashed) {
    assert.ok(permittedRoots.includes(await realpath(dirname(item.destination))));
    if (item.source === installation) assert.ok(basename(item.destination).includes(token));
    else assert.equal(JSON.parse(await readFile(join(item.destination, 'uninstall-test-marker.json'), 'utf8')).token, token);
    await rm(item.destination, { recursive: true });
  }
  await pass('only this test’s verified disposable Trash entries were cleaned up');
} catch (error) {
  report.error = error.stack || String(error);
  throw error;
} finally {
  inspector?.close();
  if (running && running.exitCode === null && running.signalCode === null) {
    if (childPID) try { process.kill(childPID, 'SIGTERM'); } catch {}
    await sleep(500);
    if (running.exitCode === null) {
      if (launcherPID) try { process.kill(launcherPID, 'SIGTERM'); } catch { /* Test launcher already exited. */ }
      running.kill('SIGTERM');
    }
  }
  if (mounted) await run('/usr/bin/hdiutil', ['detach', mount]).catch(error => { report.detachError = error.message; });
  report.finishedAt = new Date().toISOString();
  await log.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`Report: ${join(output, 'report.json')}`);
}
