export const musicPlaylist = (id, title) => ({ musicResponsiveListItemRenderer: {
  flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } }],
  navigationEndpoint: { browseEndpoint: { browseId: `VL${id}`, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_PLAYLIST' } } } },
} });

export function musicSearchBootstrap() {
  const data = { contents: ['Community playlists', 'Featured playlists', 'Songs'].map((label, index) => ({ chipCloudChipRenderer: { text: { runs: [{ text: label }] }, navigationEndpoint: { searchEndpoint: { params: `type-${index}` } } } })) };
  return `ytcfg.set(${JSON.stringify({ INNERTUBE_CLIENT_VERSION: '1.test', INNERTUBE_CONTEXT: { client: { visitorData: 'private-session-value' } } })});initialData.push({data:'${JSON.stringify(data)}'});`;
}

export function musicSearchResult(items, continuation) {
  return { contents: { musicShelfRenderer: { contents: items, ...(continuation ? { continuations: [{ nextContinuationData: { continuation } }] } : {}) } } };
}
