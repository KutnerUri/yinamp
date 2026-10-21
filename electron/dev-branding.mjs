import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// macOS uses the executable bundle's name for its first menu, even when app.setName is set.
// Brand a private cached copy so development never modifies a running/shared Electron install.
export async function developmentExecutable(executable) {
  if (process.platform !== 'darwin') return executable;
  const source = dirname(dirname(dirname(executable)));
  const original = await readFile(join(source, 'Contents/Info.plist'), 'utf8');
  const key = createHash('sha256').update(original + 'yinamp-dev-v1').digest('hex').slice(0, 16);
  const cache = fileURLToPath(new URL('../node_modules/.cache/yinamp/', import.meta.url));
  const destination = join(cache, key, 'Yinamp.app');
  const binary = join(destination, 'Contents/MacOS', executable.split('/').at(-1));
  try { await access(binary); return binary; } catch { /* Prepare this runtime once. */ }
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'branding-'));
  try {
    const bundle = join(temporary, 'Yinamp.app');
    // APFS clone avoids duplicating the runtime's disk blocks; other filesystems use a normal copy.
    try { execFileSync('/bin/cp', ['-cR', source, bundle], { stdio: 'pipe' }); }
    catch { await rm(bundle, { recursive: true, force: true }); await cp(source, bundle, { recursive: true }); }
    let plist = original;
    for (const [field, value] of Object.entries({ CFBundleName: 'Yinamp', CFBundleDisplayName: 'Yinamp', CFBundleIdentifier: 'com.kutneruri.yinamp.development' })) {
      plist = plist.replace(new RegExp(`(<key>${field}</key>\\s*<string>)[^<]*(</string>)`), `$1${value}$2`);
    }
    await writeFile(join(bundle, 'Contents/Info.plist'), plist);
    // Free, local ad-hoc signing keeps the copied bundle valid after changing its metadata.
    execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', bundle], { stdio: 'pipe' });
    try { await rename(temporary, dirname(destination)); }
    catch (error) {
      try { await access(binary); } catch { throw error; }
    }
    return binary;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
