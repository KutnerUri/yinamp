// Parse playlist metadata only, from YouTube Music's rendered page data.
// Keeping this function self-contained also lets the desktop run it in its webview.
export function parseMusicLibrary(data, section = 'mine') {
  if (!['mine', 'mixes', 'discover'].includes(section)) throw new Error('Unknown library view.');
  const text = value => typeof value === 'string' ? value : value?.simpleText ?? value?.content ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';
  const photo = value => {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'music.youtube.com' && url.pathname === '/image/mixart' || ['.ytimg.com', '.googleusercontent.com', '.ggpht.com', '.gstatic.com'].some(host => url.hostname.endsWith(host))) ? url.href : ''; } catch { return ''; }
  };
  const items = [], seen = new Set(), visited = new WeakSet();
  let more = false, nodes = 0;
  function card(value, context) {
    const endpoint = value.navigationEndpoint ?? value.onTap?.innertubeCommand ?? {};
    const browse = endpoint.browseEndpoint;
    const pageType = browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType ?? '';
    const title = text(value.title ?? value.metadata?.lockupMetadataViewModel?.title);
    const subtitle = text(value.subtitle);
    if (/PODCAST|EPISODE|ALBUM|ARTIST/i.test(pageType) || /PODCAST|EPISODE/i.test(value.contentType ?? '') || /podcast|פודקאסט/i.test(`${context} ${title} ${subtitle}`)) return;
    const play = (value.thumbnailOverlay ?? value.overlay)?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ?? {};
    const playlistNavigation = Boolean(endpoint.watchPlaylistEndpoint?.playlistId || browse?.browseId?.startsWith('VL') || /PLAYLIST|MIX|AUTOMIX/i.test(pageType));
    const watch = endpoint.watchEndpoint ?? play.watchEndpoint;
    // A song can start a radio queue. Its RD playlist ID does not make the card a mix.
    // Playlist cards can still carry a seed video in their play overlay.
    if (value.playlistItemData?.videoId || /SONG|VIDEO/i.test(`${pageType} ${value.contentType ?? ''}`) ||
        !playlistNavigation && (watch?.videoId || watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType)) return;
    const id = endpoint.watchPlaylistEndpoint?.playlistId ?? endpoint.watchEndpoint?.playlistId ?? (browse?.browseId?.startsWith('VL') ? browse.browseId.slice(2) : null) ?? play.watchPlaylistEndpoint?.playlistId ?? play.watchEndpoint?.playlistId;
    if (!/^[\w-]{2,150}$/.test(id ?? '') || !title || seen.has(id)) return;
    if (!/PLAYLIST|MIX|AUTOMIX/i.test(pageType) && !/^(PL|RD|LM|LL)/.test(id)) return;
    // RDCLAK IDs are YouTube Music's curated playlists, not personal radio mixes.
    const mix = /^RD(?!CLAK)/.test(id) || /AUTOMIX|MIX/i.test(pageType);
    if (section === 'mixes' && !mix || section === 'discover' && mix) return;
    seen.add(id);
    const thumbnails = value.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ?? value.thumbnail?.thumbnails ?? [];
    const bylineRuns = [...(value.subtitle?.runs ?? []), ...(value.flexColumns?.slice(1).flatMap(column => column.musicResponsiveListItemFlexColumnRenderer?.text?.runs ?? []) ?? [])];
    const owners = new Set(bylineRuns.map(run => {
      const owner = run.navigationEndpoint?.browseEndpoint;
      return owner?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL' && /^UC[\w-]{22}$/.test(owner.browseId ?? '') ? owner.browseId : null;
    }).filter(Boolean));
    const ownerId = owners.size === 1 ? [...owners][0] : null;
    items.push({ id, ownerId, title: title.slice(0, 200), subtitle: subtitle.slice(0, 200), thumbnail: photo(thumbnails.at(-1)?.url), kind: mix ? 'mix' : 'playlist', source: 'music', seed: endpoint.watchEndpoint?.videoId ?? play.watchEndpoint?.videoId ?? null });
  }
  function walk(value, context = '', depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || ++nodes > 40000 || visited.has(value)) return;
    visited.add(value);
    if (value.continuationItemRenderer || value.continuations?.length) more = true;
    const shelf = value.musicCarouselShelfRenderer ?? value.musicShelfRenderer;
    if (shelf) {
      context = text(shelf.header?.musicCarouselShelfBasicHeaderRenderer?.title ?? shelf.title);
      if (/podcast|פודקאסט/i.test(context)) return;
    }
    if (value.musicTwoRowItemRenderer) card(value.musicTwoRowItemRenderer, context);
    if (value.musicResponsiveListItemRenderer) {
      const row = value.musicResponsiveListItemRenderer;
      card({ ...row, title: row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text, subtitle: row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text }, context);
    }
    if (Array.isArray(value)) for (const child of value) walk(child, context, depth + 1);
    else for (const [key, child] of Object.entries(value)) if (!['menu', 'trackingParams', 'clickTrackingParams', 'responseContext'].includes(key)) walk(child, context, depth + 1);
  }
  walk(data);
  return { items: items.slice(0, 1000), partial: more || nodes > 40000 || items.length > 1000 };
}

// Only exclude a verified creator ID. Unknown owners, other creators and
// provider mixes without creator metadata remain in Discovery.
export function withoutOwnedPlaylists(items, ownerId) {
  return /^UC[\w-]{22}$/.test(ownerId ?? '') ? items.filter(item => item.ownerId !== ownerId) : items;
}

export function musicLibraryURL(section) {
  if (section === 'mine') return 'https://music.youtube.com/library/playlists';
  if (section === 'mixes') {
    const url = new URL('https://music.youtube.com/browse/FEmusic_mixed_for_you');
    url.searchParams.set('params', 'ggMEgAKCBA%3D%3D');
    return url.href;
  }
  if (section === 'discover') return 'https://music.youtube.com/';
  throw new Error('Unknown library view.');
}

export function playlistURL(value) {
  if (!/^[\w-]{2,150}$/.test(value?.id ?? '')) throw new Error('Invalid playlist.');
  const host = value.source === 'music' ? 'music.youtube.com' : 'www.youtube.com';
  const url = new URL(`https://${host}/${/^[\w-]{11}$/.test(value.seed ?? '') ? 'watch' : 'playlist'}`);
  url.searchParams.set('list', value.id);
  if (/^[\w-]{11}$/.test(value.seed ?? '')) url.searchParams.set('v', value.seed);
  return url.href;
}

export function parsePlaylistTracks(data) {
  const text = value => value?.simpleText ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';
  const tracks = [], seen = new Map(), visited = new WeakSet(); let partial = false;
  function row(value, counterpart) {
    const old = value.playlistVideoRenderer ?? value.playlistPanelVideoRenderer;
    const music = value.musicResponsiveListItemRenderer;
    const modern = value.lockupViewModel ?? value.richItemRenderer?.content?.lockupViewModel;
    const id = old?.videoId ?? music?.playlistItemData?.videoId ?? music?.navigationEndpoint?.watchEndpoint?.videoId ?? (modern?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? modern.contentId : null);
    if (!/^[\w-]{11}$/.test(id ?? '') || old?.isPlayable === false || old?.unplayableText) return;
    const title = text(old?.title ?? music?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text) || modern?.metadata?.lockupMetadataViewModel?.title?.content || `YouTube — ${id}`;
    const length = text(old?.lengthText ?? music?.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
    const duration = /^\d+(?::\d{2}){1,2}$/.test(length) ? length.split(':').reduce((total, part) => total * 60 + Number(part), 0) : 0;
    const track = { id, title: title.slice(0, 300), duration, start: 0 };
    // Only typed Music links establish artist/album identity; channel bylines
    // and unlinked subtitle text are not reliable music metadata.
    const runs = [old?.longBylineText, old?.shortBylineText, old?.subtitle,
      ...(music?.flexColumns ?? []).slice(1).map(column => column.musicResponsiveListItemFlexColumnRenderer?.text)]
      .flatMap(value => value?.runs ?? []);
    for (const [field, pageType] of [['artist', 'MUSIC_PAGE_TYPE_ARTIST'], ['album', 'MUSIC_PAGE_TYPE_ALBUM']]) {
      const names = runs.filter(run => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === pageType)
        .map(run => typeof run.text === 'string' ? run.text.trim() : '').filter(Boolean);
      const value = [...new Set(names)].join(', ').slice(0, 300);
      if (value) track[field] = value;
    }
    const versions = {};
    const kind = renderer => {
      const type = renderer?.navigationEndpoint?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
      return type === 'MUSIC_VIDEO_TYPE_ATV' ? 'song' : type === 'MUSIC_VIDEO_TYPE_OMV' ? 'video' : null;
    };
    // Some queue copies omit the primary type but retain the counterpart's type.
    const otherKind = kind(counterpart);
    const mode = kind(old ?? music) ?? (otherKind === 'song' ? 'video' : otherKind === 'video' ? 'song' : null);
    if (mode) versions[mode] = { id, duration };
    const otherId = counterpart?.videoId;
    const otherMode = kind(counterpart) ?? (mode === 'song' ? 'video' : mode === 'video' ? 'song' : null);
    if (otherMode && /^[\w-]{11}$/.test(otherId ?? '') && otherId !== id && counterpart.isPlayable !== false && !counterpart.unplayableText) {
      const length = text(counterpart.lengthText);
      const duration = /^\d+(?::\d{2}){1,2}$/.test(length) ? length.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) : 0;
      versions[otherMode] = { id: otherId, duration };
    }
    if (Object.keys(versions).length) track.versions = versions;
    const previous = seen.get(id);
    if (previous) {
      for (const field of ['artist', 'album']) if (!previous[field] && track[field]) previous[field] = track[field];
      if (track.versions) previous.versions = { ...previous.versions, ...track.versions };
      if (!previous.duration && duration) previous.duration = duration;
    } else { seen.set(id, track); tracks.push(track); }
  }
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 35 || visited.has(value)) return;
    visited.add(value);
    // The live Music queue exposes an array of wrappers, without a shelf renderer.
    if (value.playlistPanelVideoWrapperRenderer) {
      const wrapper = value.playlistPanelVideoWrapperRenderer;
      row(wrapper.primaryRenderer ?? {}, wrapper.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer);
      return;
    }
    if (value.playlistPanelVideoRenderer) { row(value); return; }
    for (const key of ['playlistVideoListRenderer', 'playlistPanelRenderer', 'musicPlaylistShelfRenderer']) if (value[key]) {
      const shelf = value[key]; if (shelf.continuations?.length) partial = true;
      for (const item of shelf.contents ?? []) {
        if (item.continuationItemRenderer) partial = true;
        row(item);
        if (item.playlistPanelVideoWrapperRenderer?.primaryRenderer) {
          const wrapper = item.playlistPanelVideoWrapperRenderer;
          row(wrapper.primaryRenderer, wrapper.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer);
        }
      }
      return;
    }
    if (Array.isArray(value)) for (const child of value) walk(child, depth + 1);
    else for (const [key, child] of Object.entries(value)) if (!['menu', 'responseContext', 'secondaryResults'].includes(key)) walk(child, depth + 1);
  }
  walk(data);
  return { tracks, partial };
}
