import { readFile } from 'node:fs/promises';

const { version } = JSON.parse(await readFile(new URL('package.json', import.meta.url), 'utf8'));
export function stampAppVersion(html) {
  return html.replace(/(<span class="version">)[^<]*(<\/span>)/, (_match, open, close) => `${open}v${version}${close}`);
}
