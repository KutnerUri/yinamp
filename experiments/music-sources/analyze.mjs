import { gunzipSync, brotliDecompressSync } from 'node:zlib';
const text = value => typeof value === 'string' ? value : value?.simpleText ?? value?.content ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';
const pageType = endpoint => endpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';

export function requestSummary(url, body, transport) {
  const target = new URL(url);
  if (target.hostname !== 'music.youtube.com' || !/^\/youtubei\/v1\/[a-zA-Z0-9_/-]+$/.test(target.pathname)) return null;
  let data, payloadFormat; try { data = JSON.parse(body || '{}'); payloadFormat = body ? 'json' : 'absent'; } catch { data = {}; payloadFormat = 'non-json'; }
  const safe = value => typeof value === 'string' ? value.slice(0, 300) : undefined;
  // No headers, cookies, account/delegation context, full URL, or continuation values.
  return { endpoint: target.pathname, transport, payloadFormat, payloadKeys: Object.keys(data).slice(0, 20), query: safe(data.query), browseId: safe(data.browseId), params: safe(data.params),
    urlQueryKeys: [...new Set(target.searchParams.keys())], hasUrlContinuation: ['continuation', 'ctoken'].some(key => target.searchParams.has(key)), hasContinuation: Boolean(data.continuation), client: safe(data.context?.client?.clientName),
    version: safe(data.context?.client?.clientVersion), locale: safe(data.context?.client?.hl) };
}

export function decodeRequestPayload(request) {
  const headers = request.headers ?? {};
  const header = name => Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const contentType = header('content-type'), encoding = header('content-encoding');
  let body = request.postData;
  if (request.postDataEntries?.some(entry => entry.bytes)) {
    try {
      let buffer = Buffer.concat(request.postDataEntries.filter(entry => entry.bytes).map(entry => Buffer.from(entry.bytes, 'base64')));
      if (encoding === 'gzip' || buffer[0] === 0x1f && buffer[1] === 0x8b) buffer = gunzipSync(buffer, { maxOutputLength: 1000000 });
      else if (encoding === 'br') buffer = brotliDecompressSync(buffer, { maxOutputLength: 1000000 });
      body = buffer.toString();
    } catch { body = undefined; }
  }
  return { body, contentType, encoding };
}

export function analyzeMusicData(data) {
  const cards = [], shelves = [], renderers = {}, thumbnailPaths = {}, thumbnailHosts = {}, navigationCommands = [], continuationKinds = {}, visited = new WeakSet();
  let nodes = 0, continuations = 0;
  function artwork(value) {
    const found = [];
    function walk(node, path, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 7) return;
      if (Array.isArray(node.thumbnails)) for (const thumb of node.thumbnails) {
        try {
          const url = new URL(thumb.url, 'https://music.youtube.com');
          thumbnailHosts[url.hostname] = (thumbnailHosts[url.hostname] ?? 0) + 1;
          if (url.protocol === 'https:' && (url.hostname === 'music.youtube.com' && url.pathname === '/image/mixart' || ['.ytimg.com', '.googleusercontent.com', '.ggpht.com', '.gstatic.com'].some(host => url.hostname.endsWith(host)))) found.push({ url: url.href, path: `${path}.thumbnails`, width: thumb.width ?? 0 });
        } catch {}
      }
      for (const [key, child] of Object.entries(node)) if (key !== 'thumbnails') walk(child, `${path}.${key}`, depth + 1);
    }
    for (const key of ['thumbnail', 'thumbnailRenderer', 'image']) if (value[key]) walk(value[key], key);
    found.sort((a, b) => b.width - a.width);
    return found[0];
  }
  function card(value, renderer) {
    const endpoint = value.navigationEndpoint ?? value.onTap?.innertubeCommand ?? {};
    const watch = endpoint.watchEndpoint ?? endpoint.watchPlaylistEndpoint;
    const id = value.playlistItemData?.videoId ?? watch?.videoId ?? watch?.playlistId ?? endpoint.browseEndpoint?.browseId;
    const title = text(value.title ?? value.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
    const art = artwork(value);
    const thumbnailShapes = [];
    function shape(node, path, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 12) return;
      for (const [key, child] of Object.entries(node)) {
        if (key === 'url' && typeof child === 'string') { try { const u = new URL(child, 'https://music.youtube.com'); thumbnailShapes.push({ path: path + '.url', relative: !/^https?:/.test(child), host: u.hostname, staticPath: u.hostname === 'music.youtube.com' || u.hostname.endsWith('gstatic.com') ? u.pathname.slice(0, 180) : undefined }); } catch {} }
        else if (typeof child === 'object') shape(child, path + '.' + key, depth + 1);
      }
    }
    for (const key of ['thumbnail', 'thumbnailRenderer', 'image']) shape(value[key], key);
    if (art) thumbnailPaths[art.path] = (thumbnailPaths[art.path] ?? 0) + 1;
    if (!title) return;
    const runs = value.flexColumns?.flatMap(column => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) ?? [];
    cards.push({ id, title: title.slice(0, 200), renderer, navigation: Object.keys(endpoint).filter(key => key.endsWith('Endpoint')),
      browseType: pageType(endpoint), hasVideo: Boolean(watch?.videoId ?? value.playlistItemData?.videoId),
      playlistId: watch?.playlistId, artist: runs.filter(run => pageType(run.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ARTIST').map(run => run.text).join(', '),
      album: runs.filter(run => pageType(run.navigationEndpoint) === 'MUSIC_PAGE_TYPE_ALBUM').map(run => run.text).join(', '),
      thumbnailShapes, thumbnail: art?.url ?? '', thumbnailPath: art?.path ?? '', keys: Object.keys(value).filter(key => !/tracking|menu/i.test(key)) });
  }
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 40 || ++nodes > 80000 || visited.has(value)) return;
    visited.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (['musicNavigationButtonRenderer', 'chipCloudChipRenderer', 'tabRenderer'].includes(key)) { const e = child?.navigationEndpoint ?? child?.endpoint ?? child?.clickCommand ?? {}; navigationCommands.push({ renderer: key, label: text(child?.buttonText ?? child?.text ?? child?.title), browseId: e.browseEndpoint?.browseId, params: e.browseEndpoint?.params ?? e.searchEndpoint?.params, hasSearch: Boolean(e.searchEndpoint), endpointKeys: Object.keys(e).filter(k => k.endsWith('Endpoint')) }); }
      if (['nextContinuationData', 'reloadContinuationData', 'continuationCommand'].includes(key)) continuationKinds[key] = (continuationKinds[key] ?? 0) + 1;
      if (key.endsWith('Renderer')) renderers[key] = (renderers[key] ?? 0) + 1;
      if (['musicTwoRowItemRenderer', 'musicResponsiveListItemRenderer'].includes(key)) card(child, key);
    }
    const shelf = value.musicCarouselShelfRenderer ?? value.musicShelfRenderer;
    if (shelf) {
      const header = shelf.header?.musicCarouselShelfBasicHeaderRenderer ?? {};
      const button = header.moreContentButton?.buttonRenderer;
      const endpoint = button?.navigationEndpoint ?? button?.command ?? shelf.bottomEndpoint ?? header.title?.runs?.[0]?.navigationEndpoint ?? {};
      shelves.push({ title: text(header.title ?? shelf.title).slice(0, 200), shelfId: shelf.shelfId, itemSize: shelf.itemSize, cards: shelf.contents?.length ?? 0,
        headerKeys: Object.keys(header), buttonKeys: Object.keys(button ?? {}), endpointKeys: Object.keys(endpoint).filter(key => key !== 'clickTrackingParams'),
        browseId: endpoint.browseEndpoint?.browseId, params: endpoint.browseEndpoint?.params?.slice(0, 300),
        hasWatchCommand: Boolean(endpoint.watchEndpoint ?? endpoint.watchPlaylistEndpoint), cardIds: (shelf.contents ?? []).map(item => { const v = item.musicTwoRowItemRenderer ?? item.musicResponsiveListItemRenderer ?? {}; const e = v.navigationEndpoint ?? {}; return e.browseEndpoint?.browseId ?? e.watchEndpoint?.playlistId ?? e.watchPlaylistEndpoint?.playlistId; }).filter(Boolean), shelfKeys: Object.keys(shelf).filter(key => !/tracking/i.test(key)) });
    }
    if (value.nextContinuationData || value.continuationCommand || value.reloadContinuationData) continuations++;
    for (const [key, child] of Object.entries(value)) if (!['menu', 'responseContext', 'trackingParams', 'clickTrackingParams'].includes(key)) walk(child, depth + 1);
  }
  walk(data);
  return { cards: cards.slice(0, 500), count: cards.length, unique: new Set(cards.map(card => card.id).filter(Boolean)).size,
    withArtwork: cards.filter(card => card.thumbnail).length, thumbnailPaths, thumbnailHosts, shelves, renderers, continuations, continuationKinds, navigationCommands };
}
