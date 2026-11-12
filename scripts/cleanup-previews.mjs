// Delete a branch's preview builds once the branch is gone: its prereleases (with their
// tags) and any leftover desktop-v<version> reservation tags from the old versioning.
// Never touches main's stable releases or latest-build.
//   GH_REPO=owner/name node scripts/cleanup-previews.mjs <branch>
import { spawnSync } from 'node:child_process';
import { branchSlug } from './desktop-version.mjs';
import { parseVersion, versionFromLabel } from '../electron/versions.mjs';

const branch = process.argv[2];
const repo = process.env.GH_REPO;
if (!branch) throw new Error('Usage: cleanup-previews.mjs <branch>');
if (!repo) throw new Error('GH_REPO is required');
if (['main', 'master'].includes(branch)) throw new Error('Refusing to clean up the main branch');
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `gh ${args[0]} failed`);
  return result.stdout;
}
const lines = output => output.split('\n').filter(Boolean);
const slug = branchSlug(branch);
// Preview versions look like 1.2.20-<slug>.<run>.<attempt>.
const isPreview = version => {
  const parsed = parseVersion(version ?? '');
  return Boolean(parsed) && parsed.prerelease.length === 3 && parsed.prerelease[0] === slug;
};

const releases = lines(gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[] | {tag: .tag_name, name: .name, prerelease: .prerelease}'])).map(line => JSON.parse(line));
const previews = releases.filter(release => release.prerelease && release.tag !== 'latest-build' && isPreview(versionFromLabel(release.name)));
for (const release of previews) {
  gh(['release', 'delete', release.tag, '--yes', '--cleanup-tag']);
  console.log(`Deleted preview ${release.name} (${release.tag})`);
}
const reservations = lines(gh(['api', '--paginate', `repos/${repo}/tags?per_page=100`, '--jq', '.[].name'])).filter(tag => tag.startsWith('desktop-v') && isPreview(tag.slice('desktop-v'.length)));
for (const tag of reservations) {
  gh(['api', '--method', 'DELETE', `repos/${repo}/git/refs/tags/${tag}`]);
  console.log(`Deleted tag ${tag}`);
}
console.log(`${branch}: removed ${previews.length} preview release(s) and ${reservations.length} old version tag(s).`);
