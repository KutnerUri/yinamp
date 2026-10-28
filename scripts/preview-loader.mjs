// Compile and run only the native presentation helper; no installation or profile.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

if (process.platform !== 'darwin') throw new Error('The native animation preview currently requires macOS.');
const directory = await mkdtemp(join(tmpdir(), 'yinamp-loader-preview-'));
try {
  const binary = join(directory, 'Yinamp Loader Preview');
  const build = spawnSync('/usr/bin/clang', ['-fobjc-arc', '-Os', '-framework', 'Cocoa', 'launcher/ui/progress-mac.m', '-o', binary], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error('Could not compile loader preview');
  const child = spawn(binary, ['--animation-mode'], { stdio: 'inherit' });
  const stop = () => child.kill();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('Loader animation preview is running. Press Escape in its window to close.');
  await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
} finally {
  await rm(directory, { recursive: true, force: true });
}
