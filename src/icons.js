// Fixed geometry keeps small controls aligned across system fonts and skins.
const paths = {
  "play": "<path d=\"M5 3 13 8 5 13Z\" fill=\"currentColor\" stroke=\"none\"/>",
  "pause": "<path d=\"M5 3v10M11 3v10\" stroke-width=\"3\"/>",
  "stop": "<path d=\"M4 4h8v8H4Z\" fill=\"currentColor\" stroke=\"none\"/>",
  "previous": "<path d=\"M3 3v10M12 3 5 8l7 5Z\"/>",
  "next": "<path d=\"M13 3v10M4 3l7 5-7 5Z\"/>",
  "eject": "<path d=\"m3 10 5-7 5 7Z\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M3 13h10\"/>",
  "close": "<path d=\"m4 4 8 8m0-8-8 8\"/>",
  "collapse": "<path d=\"M3 12h10\"/>",
  "fullscreen": "<path d=\"M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4\"/>",
  "refresh": "<path d=\"M13 7a5 5 0 1 0-1 4M13 2v5H8\"/>",
  "up": "<path d=\"M8 13V3M3 8l5-5 5 5\"/>",
  "down": "<path d=\"M8 3v10M3 8l5 5 5-5\"/>",
  "external": "<path d=\"M9 2h5v5m0-5L7 9M6 3H2v11h11v-4\"/>",
  "pin": "<path d=\"m5 2 6 0-1 4 3 3H3l3-3Zm3 7v5\"/>"
};

export function icon(name) {
  return `<svg class="control-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
