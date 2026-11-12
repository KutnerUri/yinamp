import { readFile } from 'node:fs/promises';

// CI passes the git-derived version; local runs show package.json's.
export const version = process.env.YINAMP_BUILD_VERSION || JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8')).version;
export function stampAppVersion(html) {
  return html.replace(/(<span class="version">)[^<]*(<\/span>)/, (_match, open, close) => `${open}v${version}${close}`);
}
