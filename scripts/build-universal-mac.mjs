// Merge the compact native bundles, preserving each Go slice's embedded payload.
import { cp, mkdtemp, readdir, readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
export async function buildUniversalMac({ packageDMG = true } = {}) {
  if (process.platform !== 'darwin') throw new Error('Universal Mac packaging requires macOS');
  const root = resolve('release');
  const inputs = ['arm64', 'x64'].map(arch => join(root, `compact-darwin-${arch}`, 'Yinamp.app'));
  const executables = ['Contents/MacOS/Yinamp', 'Contents/Helpers/Yinamp Loader.app/Contents/MacOS/Yinamp Loader'];
  // Every shared file must match. Only native executables and their signatures may differ.
  async function compare(relative = '') {
    const entries = await Promise.all(inputs.map(app => readdir(join(app, relative), { withFileTypes: true })));
    const names = entries.map(list => list.map(entry => entry.name).filter(name => name !== '_CodeSignature').sort());
    if (JSON.stringify(names[0]) !== JSON.stringify(names[1])) throw new Error(`Mac bundle layouts differ: ${relative}`);
    for (const name of names[0]) {
      const path = relative ? `${relative}/${name}` : name;
      if (executables.includes(path)) continue;
      if (entries.every(list => list.find(entry => entry.name === name)?.isDirectory())) await compare(path);
      else {
        const bytes = await Promise.all(inputs.map(app => readFile(join(app, path))));
        if (!bytes[0].equals(bytes[1])) throw new Error(`Mac bundle resources differ: ${path}`);
      }
    }
  }
  await compare();
  const temporary = await mkdtemp(join(tmpdir(), 'yinamp-universal-'));
  const destination = join(root, 'compact-darwin-universal', 'Yinamp.app');
  try {
    const app = join(temporary, 'Yinamp.app');
    await cp(inputs[0], app, { recursive: true, verbatimSymlinks: true });
    for (const relative of executables) {
      run('/usr/bin/lipo', ['-create', ...inputs.map(input => join(input, relative)), '-output', join(app, relative)]);
      run('/usr/bin/lipo', [join(app, relative), '-verify_arch', 'arm64', 'x86_64']);
    }
    const helper = join(app, 'Contents/Helpers/Yinamp Loader.app');
    for (const bundle of [helper, app]) {
      await rm(join(bundle, 'Contents/_CodeSignature'), { recursive: true, force: true });
      run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
    }
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    await rm(destination, { recursive: true, force: true });
    await mkdir(join(root, 'compact-darwin-universal'), { recursive: true });
    await cp(app, destination, { recursive: true, verbatimSymlinks: true });
  } finally { await rm(temporary, { recursive: true, force: true }); }
  if (packageDMG) {
    const metadata = JSON.parse(await readFile('build-info.json', 'utf8'));
    run(process.execPath, [fileURLToPath(import.meta.resolve('electron-builder/cli.js')), '--prepackaged', destination, '--mac', '--universal', '--publish', 'never', `-c.extraMetadata.version=${metadata.version}`]);
  }
  return destination;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildUniversalMac();
