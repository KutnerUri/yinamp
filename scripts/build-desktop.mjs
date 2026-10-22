import { spawnSync } from 'node:child_process';
import './prepare-build.mjs';
import { buildCompact } from './build-compact.mjs';

const args = process.argv.slice(2);
const dirOnly = args.includes('--dir');
const platform = args.includes('--mac') ? 'darwin' : args.includes('--win') ? 'win32' : args.includes('--linux') ? 'linux' : process.platform;
const arch = args.includes('--arm64') ? 'arm64' : args.includes('--x64') ? 'x64' : process.arch;
if (!['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(`${platform}-${arch}`)) throw new Error('Unsupported desktop target');
if (platform !== process.platform) throw new Error('Build compact packages on their target OS');
const builder = process.platform === 'win32' ? 'node_modules/.bin/electron-builder.cmd' : 'node_modules/.bin/electron-builder';
function run(parameters) {
  const result = spawnSync(builder, parameters, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error('Desktop packaging failed');
}
const target = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
run([`--${target}`, `--${arch}`, '--dir', '--publish', 'never']);
const compact = await buildCompact({ platform, arch });
if (!dirOnly) run(['--prepackaged', compact, `--${target}`, `--${arch}`, '--publish', 'never']);
