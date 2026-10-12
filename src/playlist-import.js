import { loadYouTubeAPI } from './youtube.js';

const unavailable = 'This playlist could not be loaded. It may be private, empty, or unavailable in embedded players.';

function abortError() { return new DOMException('Playlist loading cancelled.', 'AbortError'); }

function waitForAPI(signal) {
  if (!signal) return loadYouTubeAPI();
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError());
    signal.addEventListener('abort', cancel, { once: true });
    loadYouTubeAPI().then(api => { signal.removeEventListener('abort', cancel); resolve(api); }, error => { signal.removeEventListener('abort', cancel); reject(error); });
  });
}

/** Read the playlist through a visible, temporary preview without interrupting the main player. */
export async function readOnlinePlaylist(playlistId, { container, signal, timeout = 20000 }) {
  if (!/^[\w-]{2,150}$/.test(playlistId)) throw new Error('Invalid YouTube playlist ID.');
  if (signal?.aborted) throw abortError();
  const YT = await waitForAPI(signal);
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let preview;
    let timer;
    let poll;
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer); clearInterval(poll);
      signal?.removeEventListener('abort', cancel);
      preview?.destroy();
      container.replaceChildren();
    };
    const finish = (error, ids) => {
      if (finished) return;
      finished = true; cleanup();
      if (error) reject(error); else resolve(ids);
    };
    const cancel = () => finish(abortError());
    const inspect = () => {
      if (finished || !preview) return;
      const ids = preview.getPlaylist();
      if (Array.isArray(ids) && ids.some(id => /^[\w-]{11}$/.test(id))) finish(null, ids.filter(id => /^[\w-]{11}$/.test(id)));
    };
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => finish(new Error(unavailable)), timeout);
    const target = document.createElement('div');
    container.replaceChildren(target);
    try {
      preview = new YT.Player(target, {
        width: '100%', height: '100%',
        playerVars: { origin: location.origin, listType: 'playlist', list: playlistId, autoplay: 0, playsinline: 1, controls: 1 },
        events: {
          onReady: event => {
            if (finished) return;
            preview = event.target;
            preview.getIframe().title = 'YouTube playlist preview';
            preview.getIframe().setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            poll = setInterval(inspect, 200);
            inspect();
          },
          onStateChange: inspect,
          onError: () => { inspect(); if (!finished) finish(new Error(unavailable)); },
        },
      });
    } catch { finish(new Error('YouTube could not open this playlist. Please try again.')); }
  });
}

export async function readPlaylistWithFallback(playlistId, options) {
  try {
    return { ids: await readOnlinePlaylist(playlistId, options), tracks: [], partial: false };
  } catch (error) {
    if (error.name === 'AbortError' || options.signal?.aborted) throw error;
    options.onFallback?.();
    const response = await (options.fetcher ?? fetch)(`/api/playlist?id=${encodeURIComponent(playlistId)}`, { signal: options.signal });
    if (response.status === 404) throw new Error('The playlist preview was blocked. Restart Yinamp’s local server, refresh, and try again.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'YouTube’s public playlist listing could not be loaded.');
    const tracks = Array.isArray(data.tracks) ? data.tracks.filter(track => /^[\w-]{11}$/.test(track?.id ?? '')) : [];
    if (!tracks.length) throw new Error('YouTube did not expose any public videos in this playlist.');
    return { ids: tracks.map(track => track.id), tracks, partial: data.partial === true };
  }
}
