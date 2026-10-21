const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

function link(path) {
  const absolute = resolve(path);
  const url = pathToFileURL(absolute).href;
  return process.stdout.isTTY ? `\x1b]8;;${url}\x1b\\${absolute}\x1b]8;;\x1b\\` : url;
}

module.exports = ({ outDir, artifactPaths }) => {
  console.log(`\nDesktop build ready\n  Folder: ${link(outDir)}`);
  for (const path of artifactPaths) {
    if (/\.(dmg|exe|AppImage)$/i.test(path)) console.log(`  Download: ${link(path)}`);
  }
  console.log('');
  return [];
};
