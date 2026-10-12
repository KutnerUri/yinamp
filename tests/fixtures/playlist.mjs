export function playlistPage(items, { legacy = false, id = 'PL_public' } = {}) {
  const listed = legacy ? [{ playlistVideoListRenderer: { contents: items } }] : items;
  const content = { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: listed } }] } };
  const data = {
    metadata: { playlistMetadataRenderer: { title: 'Public playlist', androidAppindexingLink: `android-app://com.google.android.youtube/http/www.youtube.com/playlist?list=${id}` } },
    contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, content } }] } },
    secondaryContents: { lockupViewModel: { contentId: '9bZkp7q19f0', contentType: 'LOCKUP_CONTENT_TYPE_VIDEO' } },
  };
  return `<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
}
