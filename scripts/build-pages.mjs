import { stampAppVersion, version } from '../app-version.mjs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('src/vendor/', output), { recursive: true });
for (const directory of ['src', 'skins']) await cp(new URL(directory, root), new URL(directory, output), { recursive: true });
await cp(new URL('LICENSE', root), new URL('LICENSE', output));
await cp(fileURLToPath(import.meta.resolve('@preact/signals-core')), new URL('src/vendor/signals-core.js', output));
await cp(new URL('../node_modules/@preact/signals-core/LICENSE', import.meta.url), new URL('src/vendor/signals-core.LICENSE', output));
let html = stampAppVersion(await readFile(new URL('index.html', root), 'utf8'));
html = html.replaceAll('"/src/', '"./src/').replace('<script type="module" src="./src/app.js"></script>', '<script type="module" src="./src/pages-demo.js"></script>');
html = html.replace('href="/"', 'href="./"');
// Search and share metadata (the demo is the public landing page; the desktop app keeps its own title).
const [owner = 'KutnerUri', repo = 'yinamp'] = (process.env.GITHUB_REPOSITORY || '').split('/').filter(Boolean);
const siteUrl = process.env.YINAMP_SITE_URL || `https://${owner.toLowerCase()}.github.io/${repo}/`;
const repoUrl = `https://github.com/${owner}/${repo}`;
const description = 'Yinamp is a free, open-source, Winamp-inspired music player for YouTube and YouTube Music. Skinnable, draggable windows, playlists, and a desktop app for macOS, Windows, and Linux.';
const image = `${siteUrl}og-image.png`;
const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Yinamp',
  description,
  url: siteUrl,
  image,
  applicationCategory: 'MultimediaApplication',
  operatingSystem: 'macOS, Windows, Linux, Web browser',
  softwareVersion: version,
  license: `${repoUrl}/blob/main/LICENSE`,
  downloadUrl: `${repoUrl}/releases/tag/latest-build`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};
const values = {
  title: 'Yinamp — Winamp-style music player for YouTube',
  description, siteUrl, repoUrl, image,
  // Google Search Console ownership token for the demo's URL-prefix property (public by design).
  googleVerification: 'c_65gtO5NzbmPFhvR7kkY-1wM0badmHUVpBmureBer8',
};
// Already safe inside <script>: JSON with "<" escaped, so it is inserted as is.
const raw = { structuredData: JSON.stringify(structuredData).replace(/</g, '\\u003c') };

// scripts/pages.html holds the demo-only HTML as <template id="NAME"> elements with {{placeholders}};
// each template replaces the matching "pages:NAME" marker (or marker pair) in index.html.
const escape = text => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fill = section => section.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
  if (Object.hasOwn(raw, name)) return raw[name];
  if (Object.hasOwn(values, name)) return escape(values[name]);
  throw new Error(`build-pages: unknown placeholder {{${name}}} in scripts/pages.html.`);
});
const template = await readFile(new URL('scripts/pages.html', root), 'utf8');
// The marker already sits at the right indentation, so drop the content's first indent and trailing whitespace.
const sections = new Map();
for (const [, name, body] of template.matchAll(/<template id="(\w+)">([\s\S]*?)<\/template>/g)) {
  if (sections.has(name)) throw new Error(`build-pages: scripts/pages.html has two <template id="${name}">.`);
  sections.set(name, fill(body.trimStart().trimEnd()));
}
for (const [name, body] of sections) {
  const marker = new RegExp(`<!-- pages:${name} -->(?:[\\s\\S]*?<!-- /pages:${name} -->)?`);
  if (!marker.test(html)) throw new Error(`build-pages: index.html has no "pages:${name}" marker for <template id="${name}"> in scripts/pages.html.`);
  html = html.replace(marker, () => body);
}
if (/<!-- \/?pages:\w+ -->/.test(html)) throw new Error('build-pages: index.html has a "pages:" marker with no <template> in scripts/pages.html.');
await writeFile(new URL('index.html', output), html);
await cp(new URL('docs/images/yinamp-og.png', root), new URL('og-image.png', output));
await writeFile(new URL('sitemap.xml', output), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${siteUrl}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);
await writeFile(new URL('.nojekyll', output), '');
// CI reads this from the live site to decide whether the next commit needs a deployment.
await writeFile(new URL('version.json', output), JSON.stringify({ version, commit: process.env.YINAMP_COMMIT || process.env.GITHUB_SHA || 'local' }) + '\n');
console.log('GitHub Pages demo built in dist/ (relative paths support any repository name).');
