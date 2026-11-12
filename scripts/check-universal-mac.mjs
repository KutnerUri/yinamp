// Exercise the exact published DMG with disposable profiles and a native runtime.
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareCheckedRuntime } from './build-compact.mjs';
import { requireMacOSGUI } from '../tests/desktop/macos-gui.mjs';
const platform = `darwin-${process.arch}`;
if (process.platform !== 'darwin') throw new Error('Requires a native Mac runner');
await requireMacOSGUI();
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
const metadata = JSON.parse(await readFile('build-info.json', 'utf8'));
const runtime = `release/checked-runtime-${platform}`;
const archive = `release/Yinamp-${platform}.asar`;
const dmg = 'release/Yinamp-latest-mac-universal.dmg';
await prepareCheckedRuntime({ platform: 'darwin', arch: process.arch, version: metadata.electron });
const mount = await mkdtemp(join(tmpdir(), 'yinamp-universal-check-'));
let mounted = false;
try {
  run('/usr/bin/hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', mount]);
  mounted = true;
  const app = join(mount, 'Yinamp.app');
  for (const binary of ['Contents/MacOS/Yinamp', 'Contents/Helpers/Yinamp Loader.app/Contents/MacOS/Yinamp Loader']) {
    run('/usr/bin/lipo', [join(app, binary), '-verify_arch', 'arm64', 'x86_64']);
  }
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  run(process.execPath, ['tests/desktop/lifecycle.mjs', join(app, 'Contents/MacOS/Yinamp'), archive], {
    ...process.env, YINAMP_TEST_RUNTIME_DIRECTORY: runtime,
    YINAMP_UPDATE_TEST_OUTPUT: process.env.YINAMP_INSTALL_TEST_OUTPUT ? join(process.env.YINAMP_INSTALL_TEST_OUTPUT, 'lifecycle') : 'test-results/universal-lifecycle',
  });
} finally {
  if (mounted) run('/usr/bin/hdiutil', ['detach', mount]);
  await rm(mount, { recursive: true, force: true });
}
run(process.execPath, ['tests/desktop/install-uninstall.mjs', dmg, runtime, archive]);
