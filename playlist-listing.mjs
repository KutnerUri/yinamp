const videoId = /^[\w-]{11}$/;

/** Read public page data only. This never extracts media or overrides playback restrictions. */
export function parsePlaylistListing(html, playlistId) {
  const match = /(?:var\s+ytInitialData|window\["ytInitialData"\])\s*=\s*/.exec(html);
  if (!match) throw new Error('YouTube did not provide a public playlist listing.');
  const start = match.index + match[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < html.length; index++) {
    const char = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) { end = index + 1; break; }
  }
  if (end < 0) throw new Error('YouTube’s playlist listing could not be read.');
  const data = JSON.parse(html.slice(start, end));
  const metadata = data.metadata?.playlistMetadataRenderer;
  if (!metadata?.title) throw new Error('YouTube did not provide a public playlist listing.');
  if (metadata.androidAppindexingLink && !metadata.androidAppindexingLink.endsWith(`list=${playlistId}`)) throw new Error('YouTube returned a different playlist. Please copy its link again.');
  const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
  const tab = tabs.find(value => value.tabRenderer?.selected)?.tabRenderer ?? tabs[0]?.tabRenderer;
  const rows = (tab?.content?.sectionListRenderer?.contents ?? []).flatMap(section => section.itemSectionRenderer?.contents ?? []);
  const legacy = rows.find(row => row.playlistVideoListRenderer)?.playlistVideoListRenderer;
  const items = legacy?.contents ?? rows;
  const tracks = [];
  const seen = new Set();
  for (const item of items) {
    const old = item.playlistVideoRenderer;
    const modern = item.lockupViewModel ?? item.richItemRenderer?.content?.lockupViewModel;
    const id = old?.videoId ?? (modern?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? modern.contentId : null);
    if (!videoId.test(id ?? '') || seen.has(id) || old?.isPlayable === false) continue;
    seen.add(id);
    const title = old?.title?.simpleText ?? old?.title?.runs?.map(run => run.text).join('') ?? modern?.metadata?.lockupMetadataViewModel?.title?.content;
    tracks.push({ id, title: typeof title === 'string' && title.trim() ? title.slice(0, 300) : `YouTube — ${id}`, duration: 0, start: 0 });
  }
  if (!tracks.length) throw new Error('No public videos were found in this playlist. It may be empty, private, or unavailable.');
  return { title: String(metadata.title).slice(0, 300), tracks, partial: items.some(item => item.continuationItemRenderer) };
}
