// Select downstream jobs from the tested commit; no remote API or path-count limit.
import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectTargets(files, { eventName, branch, defaultBranch = 'main', inputs = {} }) {
  if (eventName === 'pull_request') return { desktop: false, demo: false };
  if (eventName === 'workflow_dispatch') return {
    desktop: inputs.desktop === true || inputs.desktop === 'true',
    demo: branch === defaultBranch && (inputs.demo === true || inputs.demo === 'true'),
  };
  if (eventName !== 'push') return { desktop: false, demo: false };
  const shared = file => /^\.github\/workflows\//.test(file) || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.node-version', '.nvmrc', 'index.html', 'LICENSE', 'scripts/ci-changes.mjs'].includes(file);
  return {
    desktop: branch === 'main' && files.some(file => shared(file) ||
      (/^(electron|src|skins|build|tests|launcher)\//.test(file) && file !== 'src/pages-demo.js') ||
      /^[^/]+\.mjs$/.test(file) || file === 'electron-builder.yml' ||
      /^scripts\/(build-(desktop|compact|universal-mac)|check-universal-mac|electron-runtime|prepare-build|desktop-version|allocate-desktop-version|create-update|publish-latest)\.mjs$/.test(file) || file === 'scripts/report-desktop.cjs'),
    demo: branch === defaultBranch && files.some(file => shared(file) || /^(src|skins)\//.test(file) || ['scripts/build-pages.mjs', 'app-version.mjs'].includes(file)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const eventName = process.env.GITHUB_EVENT_NAME;
  let files = [];
  if (eventName === 'push') {
    const head = process.env.GITHUB_SHA;
    const base = event.before;
    const args = base && !/^0+$/.test(base) ? ['diff', '--name-only', '-z', '--no-renames', base, head, '--'] : ['ls-tree', '-r', '--name-only', '-z', head, '--'];
    files = execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  }
  const selected = selectTargets(files, { eventName, branch: process.env.GITHUB_REF_NAME, defaultBranch: event.repository.default_branch, inputs: event.inputs });
  const output = Object.entries(selected).map(([name, value]) => `${name}=${value}\n`).join('');
  await appendFile(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
