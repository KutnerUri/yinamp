import electron from 'electron';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(directory, '../..');
const supplied = process.argv.find(value => value.startsWith('--source-profile='));
const original = supplied ? resolve(supplied.slice('--source-profile='.length)) : join(homedir(), 'Library/Application Support/Yinamp');
const runtime = resolve(root, `work/qa/music-source-profile-${process.pid}-${Date.now()}`);
await mkdir(resolve(root, 'work/qa'), { recursive: true });
try {
  const { stdout } = await promisify(execFile)('python3', [join(directory, 'snapshot-profile.py'), original, runtime]);
  process.stdout.write(stdout);
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [directory, `--profile=${runtime}`, ...process.argv.slice(2).filter(value => !value.startsWith('--source-profile='))], { env: environment, stdio: 'inherit' });
  const deadline = process.argv.includes('--auto') ? setTimeout(() => child.kill('SIGKILL'), 180000) : null;
  deadline?.unref();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; if (signal) console.error(`Prototype exited after ${signal}.`); resolve(); }); });
  if (deadline) clearTimeout(deadline);
} finally {
  // This unique task-owned snapshot is disposable. Never modify the source profile.
  await rm(runtime, { recursive: true, force: true });
}
