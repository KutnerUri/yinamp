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
html = html.replace('<body>', `<body>
  <aside class="demo-banner" aria-label="Desktop app downloads">
    <p><strong>✦ LIVE BROWSER DEMO</strong> · Get the desktop app for your library &amp; live search.</p>
    <div class="demo-downloads">
      <a id="desktop-download" class="download-button" href="https://github.com/KutnerUri/yinamp/releases/tag/latest-build">Download desktop app ↗</a>
      <span id="mac-downloads" hidden><a href="https://github.com/KutnerUri/yinamp/releases/download/latest-build/Yinamp-latest-mac-universal.dmg">Download for macOS</a> (Apple Silicon and Intel)</span>
      <a class="all-downloads" href="https://github.com/KutnerUri/yinamp/releases/tag/latest-build">All downloads ↗</a>
    </div>
  </aside>`);

// Search and share metadata (the demo is the public landing page; the desktop app keeps its own title).
const [owner = 'KutnerUri', repo = 'yinamp'] = (process.env.GITHUB_REPOSITORY || '').split('/').filter(Boolean);
const siteUrl = process.env.YINAMP_SITE_URL || `https://${owner.toLowerCase()}.github.io/${repo}/`;
// Google Search Console ownership token for the demo's URL-prefix property (public by design).
const GOOGLE_SITE_VERIFICATION = 'c_65gtO5NzbmPFhvR7kkY-1wM0badmHUVpBmureBer8';
const title = 'Yinamp — Winamp-style music player for YouTube';
const description = 'Yinamp is a free, open-source, Winamp-inspired music player for YouTube and YouTube Music. Skinnable, draggable windows, playlists, and a desktop app for macOS, Windows, and Linux.';
const image = `${siteUrl}og-image.png`;
const escape = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
  license: `https://github.com/${owner}/${repo}/blob/main/LICENSE`,
  downloadUrl: `https://github.com/${owner}/${repo}/releases/tag/latest-build`,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
};
html = html
  .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
  .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${escape(description)}">`)
  .replace('</head>', `  <meta name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}">
  <link rel="canonical" href="${siteUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Yinamp">
  <meta property="og:url" content="${siteUrl}">
  <meta property="og:title" content="${escape(title)}">
  <meta property="og:description" content="${escape(description)}">
  <meta property="og:image" content="${image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="The Yinamp main player window playing Rick Astley — Never Gonna Give You Up">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>
</head>`)
  .replace('<main>', `<main>
    <p class="intro-lede">Yinamp is a free, open-source music player for YouTube in the spirit of Winamp: skins, draggable windows, and playlists you can save and share. Try it here, or get the desktop app for your YouTube Music library.</p>`);
for (const [pattern, label] of [[/<title>/, 'title'], [/rel="canonical"/, 'canonical'], [/class="intro-lede"/, 'intro text'], [/name="description" content="Yinamp is/, 'description']]) {
  if (!pattern.test(html)) throw new Error(`build-pages: could not add the ${label}; index.html changed shape.`);
}
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
