import { readFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { reserveDesktopVersion } from './desktop-version.mjs';
import { versionFromLabel } from '../electron/versions.mjs';

const repo = process.env.GH_REPO;
const commit = process.env.GITHUB_SHA;
const branch = process.env.GITHUB_REF_NAME;
if (!repo || !/^[a-f0-9]{40}$/.test(commit ?? '') || !branch || !process.env.GITHUB_OUTPUT) throw new Error('Version allocation requires a GitHub workflow');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
function gh(args, optional = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0 && !optional) throw new Error(result.stderr || 'GitHub version allocation failed');
  return result;
}
async function tags() {
  return gh(['api', '--paginate', `repos/${repo}/tags?per_page=100`, '--jq', '.[].name']).stdout.trim().split('\n').filter(name => name.startsWith('desktop-v')).map(name => name.slice('desktop-v'.length));
}
// Include legacy releases, which predate the desktop-v reservation tags.
const legacy = gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`, '--jq', '.[] | select(.draft == false and (.tag_name | test("^build-[0-9]+-[0-9]+$"))) | .name']).stdout.trim().split('\n').map(versionFromLabel).filter(Boolean);
const version = await reserveDesktopVersion({
  base: pkg.version, branch, number: Number(process.env.GITHUB_RUN_NUMBER), attempt: Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  listUsed: async () => [...legacy, ...await tags()],
  reserve: async version => {
    const result = gh(['api', '--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/desktop-v${version}`, '-f', `sha=${commit}`], true);
    if (result.status === 0) return true;
    if (branch === 'main' && (await tags()).includes(version)) return false;
    throw new Error(result.stderr || 'Could not reserve the desktop version');
  },
});
await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Reserved desktop version ${version}; package.json is unchanged.`);
