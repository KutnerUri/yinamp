// Decide whether a commit needs a new desktop build or demo deployment, by comparing it
// with the last commit that was published. Reads the full local git diff (including
// deleted files), not GitHub's truncated file list.
//   node scripts/ci-changes.mjs <desktop|demo> <last-published-commit or ""> <commit>
import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectTargets(files) {
  const shared = file => /^\.github\/workflows\//.test(file) || ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.node-version', '.nvmrc', 'index.html', 'LICENSE', 'scripts/ci-changes.mjs', 'scripts/desktop-version.mjs'].includes(file);
  return {
    desktop: files.some(file => shared(file) ||
      (/^(electron|src|skins|build|tests|launcher)\//.test(file) && file !== 'src/pages-demo.js') ||
      /^[^/]+\.mjs$/.test(file) || file === 'electron-builder.yml' ||
      /^scripts\/(build-(desktop|compact|universal-mac)|check-universal-mac|electron-runtime|prepare-build|create-update|publish-latest)\.mjs$/.test(file) || file === 'scripts/report-desktop.cjs'),
    demo: files.some(file => shared(file) || /^(src|skins)\//.test(file) || ['scripts/build-pages.mjs', 'app-version.mjs'].includes(file)),
  };
}

export function changedFiles(base, head, cwd = '.') {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let known = false;
  if (base && !/^0+$/.test(base)) {
    try { git('merge-base', '--is-ancestor', base, head); known = true; } catch { /* unknown or rewritten base: treat everything as changed */ }
  }
  const output = known ? git('diff', '--name-only', '-z', '--no-renames', base, head, '--') : git('ls-tree', '-r', '--name-only', '-z', head, '--');
  return output.split('\0').filter(Boolean);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [target, base, head] = process.argv.slice(2);
  if (!['desktop', 'demo'].includes(target) || !head) throw new Error('Usage: ci-changes.mjs <desktop|demo> <base> <head>');
  const changed = selectTargets(changedFiles(base, head))[target];
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  console.log(`${target}: ${changed ? 'changes since' : 'nothing relevant changed since'} ${base || 'the beginning'}`);
}
