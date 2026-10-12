import electron from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL('..', import.meta.url)), ...process.argv.slice(2)], { env: environment, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
