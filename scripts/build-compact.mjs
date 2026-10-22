import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, rm, cp, copyFile, rename, mkdtemp, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { digest } from '../electron/update-store.mjs';
import { officialElectron } from './electron-runtime.mjs';

const builderRequire = createRequire(import.meta.resolve('electron-builder'));
const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const asar = libRequire('@electron/asar');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
export async function buildCompact({ platform, arch }) {
  const key = `${platform}-${arch}`;
  const metadata = JSON.parse(await readFile('build-info.json', 'utf8'));
  const output = resolve('release');
  const original = join(output, platform === 'darwin' ? `mac${arch === 'arm64' ? '-arm64' : ''}/Yinamp.app` : platform === 'win32' ? 'win-unpacked' : 'linux-unpacked');
  const resources = platform === 'darwin' ? 'Contents/Resources' : 'resources';
  const archive = join(original, resources, 'app.asar');
  const temporary = await mkdtemp(join(tmpdir(), 'yinamp-compact-build-'));
  try {
    const { archive: runtimeArchive, runtime } = await officialElectron({ version: metadata.electron, platform, arch });
    console.log(`Using official Electron ${metadata.electron} (${key}).`);
    // This small descriptor is part of the app manifest, never a hosted runtime release.
    await writeFile(join(output, `RUNTIME-${key}.json`), JSON.stringify(runtime, null, 2) + '\n');
    // Check the exact distributed ZIP with the production extractor, including local macOS branding and symlinks.
    const checkedRuntime = join(output, `checked-runtime-${key}`);
    await rm(checkedRuntime, { recursive: true, force: true });
    run('go', ['test', '-count=1', '-run', '^TestReleaseRuntimeExtraction$', '.'], { cwd: 'launcher', env: { ...process.env, YINAMP_TEST_RUNTIME_ZIP: runtimeArchive, YINAMP_TEST_RUNTIME_OUTPUT: checkedRuntime } });
    await writeFile(join(checkedRuntime, 'runtime.json'), JSON.stringify(runtime));
    const app = join(temporary, 'application');
    asar.extractAll(archive, app);
    await writeFile(join(app, 'build-info.json'), JSON.stringify({ ...metadata, runtime }, null, 2) + '\n');
    await asar.createPackage(app, archive + '.compact');
    await rename(archive + '.compact', archive);
    const bytes = await readFile(archive);
    const config = { id: metadata.id, platform: key, sha256: digest(bytes), runtime };
    await writeFile(join(output, `launcher-${key}.json`), JSON.stringify(config, null, 2));
    // Compile in a temporary source tree; generated embedded data never changes tracked files.
    const source = join(temporary, 'launcher'); await cp('launcher', source, { recursive: true });
    await copyFile(archive, join(source, 'assets/app.asar'));
    await writeFile(join(source, 'assets/config.json'), JSON.stringify(config));
    const compactRoot = join(output, `compact-${key}`);
    await rm(compactRoot, { recursive: true, force: true });
    const compactApp = platform === 'darwin' ? join(compactRoot, 'Yinamp.app') : compactRoot;
    const executable = platform === 'darwin' ? join(compactApp, 'Contents/MacOS/Yinamp') : join(compactApp, platform === 'win32' ? 'Yinamp.exe' : 'yinamp');
    await mkdir(dirname(executable), { recursive: true });
    run('go', ['build', '-trimpath', '-ldflags', `-s -w${platform === 'win32' ? ' -H=windowsgui' : ''}`, '-o', executable, '.'], { cwd: source, env: { ...process.env, CGO_ENABLED: '0', GOOS: platform === 'win32' ? 'windows' : platform, GOARCH: arch === 'x64' ? 'amd64' : arch } });
    if (platform === 'darwin') {
      await mkdir(join(compactApp, 'Contents/Resources'), { recursive: true });
      await copyFile('build/icon.icns', join(compactApp, 'Contents/Resources/icon.icns'));
      await writeFile(join(compactApp, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Yinamp</string><key>CFBundleIdentifier</key><string>com.kutneruri.yinamp.launcher</string><key>CFBundleName</key><string>Yinamp</string><key>CFBundleDisplayName</key><string>Yinamp</string><key>CFBundleIconFile</key><string>icon.icns</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${metadata.version.split(/[+-]/)[0]}</string><key>CFBundleVersion</key><string>${metadata.number || 1}.${metadata.attempt || 1}</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>12.0</string></dict></plist>`);
      const helper = join(compactApp, 'Contents/Helpers/Yinamp Loader.app');
      await mkdir(join(helper, 'Contents/MacOS'), { recursive: true });
      await writeFile(join(helper, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Yinamp Loader</string><key>CFBundleIdentifier</key><string>com.kutneruri.yinamp.loader</string><key>CFBundleName</key><string>Yinamp Loader</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`);
      run('/usr/bin/clang', ['-fobjc-arc', '-Os', '-framework', 'Cocoa', '-arch', arch === 'x64' ? 'x86_64' : arch, '-mmacosx-version-min=12.0', 'launcher/ui/progress-mac.m', '-o', join(helper, 'Contents/MacOS/Yinamp Loader')]);
      run('/usr/bin/codesign', ['--force', '--sign', '-', helper]);
      run('/usr/bin/codesign', ['--force', '--sign', '-', compactApp]);
    } else if (platform === 'linux') {
      await copyFile('build/icon.png', join(compactApp, 'yinamp.png'));
    }
    console.log(`Compact launcher: ${(await stat(executable)).size / 1024 / 1024 | 0} MiB; Electron is downloaded separately.`);
    return compactApp;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
