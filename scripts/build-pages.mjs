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
let html = await readFile(new URL('index.html', root), 'utf8');
html = html.replaceAll('"/src/', '"./src/').replace('<script type="module" src="./src/app.js"></script>', '<script type="module" src="./src/pages-demo.js"></script>');
html = html.replace('href="/"', 'href="./"');
html = html.replace('<body>', `<body>
  <aside class="demo-banner" aria-label="Desktop app downloads">
    <p><strong>✦ LIVE BROWSER DEMO</strong> · Get the desktop app for your library &amp; live search.</p>
    <div class="demo-downloads">
      <a id="desktop-download" class="download-button" href="https://github.com/KutnerUri/yinamp/releases/tag/latest-build">Download desktop app ↗</a>
      <span id="mac-downloads" hidden>Download for macOS: <a href="https://github.com/KutnerUri/yinamp/releases/download/latest-build/Yinamp-latest-mac-arm64.dmg">Apple Silicon</a> · <a href="https://github.com/KutnerUri/yinamp/releases/download/latest-build/Yinamp-latest-mac-x64.dmg">Intel</a></span>
      <a class="all-downloads" href="https://github.com/KutnerUri/yinamp/releases/tag/latest-build">All downloads ↗</a>
    </div>
  </aside>`);
await writeFile(new URL('index.html', output), html);
await writeFile(new URL('.nojekyll', output), '');
console.log('GitHub Pages demo built in dist/ (relative paths support any repository name).');
