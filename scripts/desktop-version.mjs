// The version follows the code: package.json sets major.minor, and every commit on the
// branch's first-parent line since that was set adds one patch (a merge counts once).
import { execFileSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVersion } from '../electron/versions.mjs';

export function versionFromHistory(base, commitsSinceBase) {
  const parsed = parseVersion(base);
  if (!parsed || parsed.prerelease.length || base.includes('+')) throw new Error('package.json version must be a stable semantic version');
  if (!Number.isSafeInteger(commitsSinceBase) || commitsSinceBase < 0) throw new Error('Invalid commit count');
  return `${parsed.major}.${parsed.minor}.${parsed.patch + commitsSinceBase}`;
}

export function branchVersion(version, branch, number, attempt) {
  if (!parseVersion(version) || !Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Invalid branch build information');
  let slug = branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'branch';
  if (/^\d+$/.test(slug)) slug = `branch-${slug}`;
  return `${version}-${slug}.${number}.${attempt}`;
}

// Main gets a stable version; other branches get a unique prerelease of it.
export function gitVersion({ cwd = '.', commit = 'HEAD', branch = 'main', number = 1, attempt = 1 } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const versionAt = revision => { try { return JSON.parse(git('show', `${revision}:package.json`)).version; } catch { return null; } };
  const base = versionAt(commit);
  if (!base) throw new Error('package.json has no version');
  // The newest first-parent commit whose own parent had a different version set the current one.
  const changes = git('log', '--first-parent', '--format=%H', commit, '--', 'package.json').split('\n').filter(Boolean);
  const bump = changes.find(change => versionAt(change) === base && versionAt(`${change}^1`) !== base);
  if (!bump) throw new Error('Could not find the commit that set the package.json version; fetch the full history');
  const version = versionFromHistory(base, Number(git('rev-list', '--first-parent', '--count', `${bump}..${commit}`)));
  return branch === 'main' ? version : branchVersion(version, branch, number, attempt);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = gitVersion({
    commit: process.env.YINAMP_COMMIT || process.env.GITHUB_SHA || 'HEAD',
    branch: process.env.YINAMP_BRANCH || process.env.GITHUB_REF_NAME || 'main',
    number: Number(process.env.GITHUB_RUN_NUMBER || 1),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(version);
}
