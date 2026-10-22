import { versionFromLabel } from './versions.mjs';
import { MAX_PAYLOAD, REPOSITORY, RELEASES, validateManifest } from './update-store.mjs';

const metadataLimit = 1024 * 1024;
const redirectHosts = new Set(['github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
export async function githubDownload(url, { limit = MAX_PAYLOAD, fetcher = fetch } = {}) {
  const initial = new URL(url);
  if (initial.protocol !== 'https:' || initial.username || initial.password || !(initial.origin === 'https://github.com' && initial.pathname.startsWith(`/${REPOSITORY}/releases/download/`) || initial.origin === 'https://api.github.com' && initial.pathname.startsWith(`/repos/${REPOSITORY}/releases`))) throw new Error('Unexpected update source');
  const signal = AbortSignal.timeout(90000);
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetcher(url, { redirect: 'manual', signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Yinamp-Updater' } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = new URL(response.headers.get('location'), url);
      await response.body?.cancel();
      if (next.protocol !== 'https:' || next.username || next.password || !redirectHosts.has(next.hostname)) throw new Error('Unexpected update redirect');
      url = next.href;
      continue;
    }
    if (!response.ok) throw new Error(`GitHub update check failed (${response.status})`);
    if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Update download is too large'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new Error('Update download is too large');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error('Too many update redirects');
}
export async function readManifest(id = 'latest-build', options) {
  if (id !== 'latest-build' && !/^build-\d+-\d+$/.test(id)) throw new Error('Invalid build ID');
  return validateManifest(JSON.parse(await githubDownload(`${RELEASES}/download/${id}/UPDATE.json`, { ...options, limit: metadataLimit })));
}
export async function listBuilds(options) {
  const builds = new Map();
  for (let page = 1; ; page++) {
    const releases = JSON.parse(await githubDownload(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`, { ...options, limit: 8 * metadataLimit }));
    if (!Array.isArray(releases)) throw new Error('Invalid build list');
    for (const item of releases) {
      if (item.draft || !/^build-\d+-\d+$/.test(item.tag_name)) continue;
      const label = String(item.name || item.tag_name).slice(0, 200);
      builds.set(item.tag_name, { id: item.tag_name, label, version: versionFromLabel(label) });
    }
    if (releases.length < 100) return [...builds.values()];
  }
}
