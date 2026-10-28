import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('universal merge preserves both native payloads, signs bundles and rejects resource drift', { skip: process.platform !== 'darwin' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'yinamp-universal-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = resolve('scripts/build-universal-mac.mjs');
  const binaries = ['Contents/MacOS/Yinamp', 'Contents/Helpers/Yinamp Loader.app/Contents/MacOS/Yinamp Loader'];
  for (const [arch, cpu] of [['arm64', 'arm64'], ['x64', 'x86_64']]) {
    const app = join(root, `release/compact-darwin-${arch}/Yinamp.app`);
    for (const [bundle, executable] of [['', 'Yinamp'], ['Contents/Helpers/Yinamp Loader.app', 'Yinamp Loader']]) {
      await mkdir(join(app, bundle, 'Contents/MacOS'), { recursive: true });
      await writeFile(join(app, bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>${executable}</string><key>CFBundleIdentifier</key><string>test.yinamp.${bundle ? 'helper' : 'launcher'}</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    }
    const source = join(root, `${arch}.c`);
    await writeFile(source, `#include <stdio.h>\nint main(void) { puts("embedded-payload-${arch}"); return 0; }\n`);
    for (const binary of binaries) execFileSync('/usr/bin/clang', ['-arch', cpu, source, '-o', join(app, binary)]);
  }
  const merge = () => execFileSync(process.execPath, ['--input-type=module', '-e', `import { buildUniversalMac } from ${JSON.stringify(script)}; await buildUniversalMac({ packageDMG: false });`], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  merge();
  const app = join(root, 'release/compact-darwin-universal/Yinamp.app');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  for (const binary of binaries) {
    const path = join(app, binary);
    execFileSync('/usr/bin/lipo', [path, '-verify_arch', 'arm64', 'x86_64']);
    const bytes = await readFile(path);
    for (const arch of ['arm64', 'x64']) assert.ok(bytes.includes(Buffer.from(`embedded-payload-${arch}`)));
    assert.equal(execFileSync(path, { encoding: 'utf8' }).trim(), `embedded-payload-${process.arch}`);
  }
  await writeFile(join(root, 'release/compact-darwin-x64/Yinamp.app/Contents/Info.plist'), 'mismatch');
  assert.throws(merge, /Mac bundle resources differ/);
});
