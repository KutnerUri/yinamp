import { parseVersion } from '../electron/versions.mjs';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { digest, mergeManifests, validateRuntime } from '../electron/update-store.mjs';

const directory = resolve(process.argv[2] || 'downloads');
function gh(args, optional = false) {
  const result = spawnSync('gh', args, { encoding: 'utf8' });
  if (result.status !== 0 && !optional) throw new Error(result.stderr || 'GitHub release command failed');
  return result.status === 0 ? result.stdout : null;
}
const files = await readdir(directory);
const fragments = await Promise.all(files.filter(file => file.endsWith('.update.json')).map(async file => JSON.parse(await readFile(join(directory, file), 'utf8'))));
const manifest = mergeManifests(fragments, process.env.GITHUB_SHA);
const { payloads: ignored, ...metadata } = manifest;
const repo = process.env.GH_REPO;
if (!repo) throw new Error('GH_REPO is required');
const isMain = !process.env.GITHUB_REF || process.env.GITHUB_REF === 'refs/heads/main';
const parsedVersion = parseVersion(manifest.version);
if (!parsedVersion || isMain === Boolean(parsedVersion.prerelease.length)) throw new Error('Main builds need stable versions; branch builds need prerelease versions');
const prerelease = isMain ? '--prerelease=false' : '--prerelease';
const head = isMain ? gh(['api', `repos/${repo}/commits/main`, '--jq', '.sha']).trim() : null;
if (isMain && head !== manifest.commit) {
  console.log('Main moved ahead; the newer run will publish its build.');
  process.exit(0);
}
const installers = files.filter(file => /\.(dmg|exe|AppImage)$/.test(file));
const requiredInstallers = ['Yinamp-latest-mac-universal.dmg', 'Yinamp-latest-mac-arm64.dmg', 'Yinamp-latest-mac-x64.dmg', 'Yinamp-latest-win-x64.exe', 'Yinamp-latest-linux-x64.AppImage'];
if (installers.length !== requiredInstallers.length || requiredInstallers.some(file => !installers.includes(file))) throw new Error('Universal Mac, both fallback Mac, Windows and Linux downloads are required');
const archives = files.filter(file => file.endsWith('.asar'));
if (archives.length !== 4) throw new Error('All four application payloads are required');
for (const [platform, payload] of Object.entries(manifest.payloads)) {
  const bytes = await readFile(join(directory, `Yinamp-${platform}.asar`));
  if (bytes.length !== payload.size || digest(bytes) !== payload.sha256) throw new Error('Update package failed its publish integrity check');
}
// Electron is downloaded directly from its official releases by the launcher.
for (const [platform, payload] of Object.entries(manifest.payloads)) validateRuntime(payload.runtime, manifest.electron, platform);
const checksumFiles = [...installers, ...archives].sort();
await writeFile(join(directory, 'SHA256SUMS.txt'), (await Promise.all(checksumFiles.map(async file => `${digest(await readFile(join(directory, file)))}  ${file}`))).join('\n') + '\n');
await writeFile(join(directory, 'UPDATE.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(join(directory, 'BUILD-INFO.json'), JSON.stringify({ ...metadata, workflow: `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}` }, null, 2) + '\n');
const notes = join(directory, 'release-notes.md');
await writeFile(notes, `Yinamp ${manifest.version} · Build ${manifest.number}.${manifest.attempt}\n\nCommit: ${manifest.commit}\n\nDownload the universal DMG for any supported Mac (Apple Silicon or Intel), portable EXE for Windows, or AppImage for Linux. Separate arm64 and x64 DMGs remain available as fallback downloads. No Node.js installation needed. These builds are unsigned; macOS and Windows may ask you to allow the app.\n\nApplication updates download silently and activate on the next launch. Yinamp → Updates: turn automatic updates on or off, or select a specific version. Electron runtimes download automatically when needed and are cached between releases. The first launch requires an internet connection.\n\nChecksums and exact build information are included. The ASAR files are application updates used by the launcher; use the DMG, EXE or AppImage for installation.\n`);
const assets = [...installers, ...archives, 'SHA256SUMS.txt', 'BUILD-INFO.json', 'UPDATE.json'].map(file => join(directory, file));
const existing = gh(['release', 'view', manifest.id, '--json', 'isDraft'], true);
if (!existing) {
  gh(['release', 'create', manifest.id, '--target', manifest.commit, '--title', `${manifest.version} · Build ${manifest.number}.${manifest.attempt}`, '--draft', prerelease, '--latest=false', '--notes-file', notes, ...assets]);
} else if (JSON.parse(existing).isDraft) {
  gh(['release', 'upload', manifest.id, ...assets, '--clobber']);
} else {
  const published = JSON.parse(gh(['release', 'download', manifest.id, '--pattern', 'UPDATE.json', '--output', '-']));
  if (JSON.stringify(published) !== JSON.stringify(manifest)) throw new Error('An existing published build cannot be replaced');
}
gh(['release', 'edit', manifest.id, '--draft=false', prerelease, '--latest=false']);
if (!isMain) {
  console.log(`Published branch preview ${manifest.version} (${manifest.id}); latest-build is unchanged.`);
  process.exit(0);
}
const latest = gh(['release', 'view', 'latest-build'], true);
const rollingAssets = [...installers, 'SHA256SUMS.txt', 'BUILD-INFO.json'].map(file => join(directory, file));
if (!latest) {
  gh(['release', 'create', 'latest-build', '--target', manifest.commit, '--title', 'Latest build', '--prerelease', '--latest=false', '--notes-file', notes, ...rollingAssets, join(directory, 'UPDATE.json')]);
} else {
  gh(['release', 'upload', 'latest-build', ...rollingAssets, '--clobber']);
  // Publish the pointer last. It refers exclusively to the completed immutable release above.
  gh(['release', 'upload', 'latest-build', join(directory, 'UPDATE.json'), '--clobber']);
  gh(['api', '--method', 'PATCH', `repos/${repo}/git/refs/tags/latest-build`, '-f', `sha=${manifest.commit}`, '-F', 'force=true']);
  gh(['release', 'edit', 'latest-build', '--title', 'Latest build', '--prerelease', '--latest=false', '--notes-file', notes]);
}
console.log(`Published ${manifest.id} and refreshed latest-build.`);
