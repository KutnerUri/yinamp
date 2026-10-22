import { createRequire } from 'node:module';
import { readFile, stat } from 'node:fs/promises';
import { digest, validateRuntime } from '../electron/update-store.mjs';

export const ELECTRON_RELEASES = 'https://github.com/electron/electron/releases/download/';
export function electronFilename(version, platform, arch) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || !['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64'].includes(`${platform}-${arch}`)) throw new Error('Unsupported Electron target');
  return `electron-v${version}-${platform}-${arch}.zip`;
}
export function electronChecksum(text, filename) {
  if (text.length > 1024 * 1024) throw new Error('Electron checksum list is too large');
  const matches = text.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line.trim())).filter(match => match?.[2] === filename);
  if (matches.length !== 1) throw new Error('Missing or ambiguous official Electron checksum');
  return matches[0][1];
}
export async function officialElectron({ version, platform, arch, fetcher = fetch, downloader } = {}) {
  const filename = electronFilename(version, platform, arch);
  const response = await fetcher(`${ELECTRON_RELEASES}v${version}/SHASUMS256.txt`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not read official Electron checksums (HTTP ${response.status})`);
  const sha256 = electronChecksum(await response.text(), filename);
  downloader ??= createRequire(import.meta.resolve('electron'))('@electron/get').downloadArtifact;
  // Pin the upstream URL even when the build machine has an Electron mirror configured.
  const archive = await downloader({ version, artifactName: 'electron', platform, arch, checksums: { [filename]: sha256 }, mirrorOptions: { mirror: ELECTRON_RELEASES, customDir: `v${version}`, customFilename: filename, resolveAssetURL: async () => `${ELECTRON_RELEASES}v${version}/${filename}` } });
  const { size } = await stat(archive);
  const runtime = validateRuntime({ version, revision: '2', url: `${ELECTRON_RELEASES}v${version}/${filename}`, sha256, size }, version, `${platform}-${arch}`);
  if (digest(await readFile(archive)) !== sha256) throw new Error('Official Electron archive failed its integrity check');
  return { archive, runtime };
}
