import { parseMusicLibrary, parsePlaylistTracks } from './src/library-data.js';

// YouTube Music embeds JSON as escaped string literals. Decode the literals,
// never evaluate the site's JavaScript or return its account/session fields.
export function musicPageData(html) {
  const objects = [];
  const pattern = /\bdata:\s*'((?:\\.|[^'\\])*)'/g;
  for (const match of html.matchAll(pattern)) {
    const decoded = match[1].replace(/\\(?:x([\da-f]{2})|u([\da-f]{4})|([\\'"/bfnrt]))/gi, (_all, hex, unicode, escaped) => hex || unicode ? String.fromCharCode(parseInt(hex ?? unicode, 16)) : ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }[escaped] ?? escaped));
    try { objects.push(JSON.parse(decoded)); } catch { /* Other embedded data is not a music listing. */ }
  }
  if (!objects.length) throw new Error('YouTube Music did not expose a music listing. Try again.');
  return objects;
}
export const parseMusicLibraryHTML = (html, section = 'discover') => parseMusicLibrary(musicPageData(html), section);
export const parseMusicPlaylistHTML = html => parsePlaylistTracks(musicPageData(html));
