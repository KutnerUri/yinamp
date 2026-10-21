import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const number = Number(process.env.GITHUB_RUN_NUMBER || 0);
const attempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);
const id = process.env.GITHUB_RUN_ID ? `build-${process.env.GITHUB_RUN_ID}-${attempt}` : `local-${Date.now()}`;
await writeFile(new URL('build-info.json', root), JSON.stringify({ protocol: 1, id, number, attempt, commit: process.env.GITHUB_SHA || 'local', version: pkg.version, electron: pkg.devDependencies.electron }, null, 2) + '\n');
console.log(`Desktop build: ${pkg.version} / ${id}`);
