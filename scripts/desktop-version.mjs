import { parseVersion, compareVersions } from '../electron/versions.mjs';

export function nextDesktopVersion(base, used) {
  if (!parseVersion(base) || parseVersion(base).prerelease.length || base.includes('+')) throw new Error('package.json version must be a stable semantic version');
  const stable = used.filter(version => parseVersion(version) && !parseVersion(version).prerelease.length);
  stable.sort((a, b) => compareVersions(b, a));
  if (!stable.length || compareVersions(base, stable[0]) > 0) return base;
  const { major, minor, patch } = parseVersion(stable[0]);
  if (!Number.isSafeInteger(patch + 1)) throw new Error('Version patch number is too large');
  return `${major}.${minor}.${patch + 1}`;
}

export function branchVersion(version, branch, number, attempt) {
  if (!parseVersion(version) || !Number.isSafeInteger(number) || number < 1 || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error('Invalid branch build information');
  let slug = branch.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'branch';
  if (/^\d+$/.test(slug)) slug = `branch-${slug}`;
  return `${version}-${slug}.${number}.${attempt}`;
}

// Creating a ref is atomic on GitHub. A competing allocator must retry rather
// than reuse a version. Failed builds keep their reservation; gaps are harmless.
export async function reserveDesktopVersion({ base, branch, number, attempt, listUsed, reserve }) {
  for (let retry = 0; retry < 20; retry++) {
    const used = await listUsed();
    const next = nextDesktopVersion(base, used);
    const version = branch === 'main' ? next : branchVersion(next, branch, number, attempt);
    if (await reserve(version)) return version;
  }
  throw new Error('Could not reserve a unique desktop version');
}
