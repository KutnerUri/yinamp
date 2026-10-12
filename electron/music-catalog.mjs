import { parseMusicLibrary, musicLibraryURL } from '../src/library-data.js';
import { musicContinuations } from '../music-query.mjs';

// Read visible catalog metadata only. Cached pages and account context are excluded.
function readCatalog(parse, continuations) {
  const active = document.querySelector('ytmusic-browse-response:not([hidden])') ?? document.querySelector('ytmusic-app #content') ?? document;
  const roots = [...active.querySelectorAll('ytmusic-grid-renderer,ytmusic-shelf-renderer,ytmusic-carousel-shelf-renderer')]
    .filter(node => node.getClientRects().length && (node.data ?? node.__data?.data))
    .map(node => {
      const data = node.data ?? node.__data?.data;
      return node.localName === 'ytmusic-carousel-shelf-renderer' ? { musicCarouselShelfRenderer: data } : node.localName === 'ytmusic-shelf-renderer' ? { musicShelfRenderer: data } : data;
    });
  const lists = [...active.querySelectorAll('ytmusic-section-list-renderer')].filter(node => node.getClientRects().length);
  const continuationData = lists.map(node => ({ continuations: (node.data ?? node.__data?.data)?.continuations }));
  const scroller = document.querySelector('ytmusic-app #content');
  return { items: parse(roots).items, signedIn: globalThis.ytcfg?.get?.('LOGGED_IN') === true,
    ready: roots.length > 0, hasMore: continuations([...roots, ...continuationData]).length > 0,
    height: scroller?.scrollHeight ?? document.documentElement.scrollHeight };
}
const snapshotScript = `(${readCatalog.toString()})(${parseMusicLibrary.toString()},${musicContinuations.toString()})`;
const scroll = `(()=>{const node=document.querySelector('ytmusic-app #content');if(node)node.scrollTop=node.scrollHeight;else window.scrollTo(0,document.documentElement.scrollHeight);})()`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Let the website make its authenticated requests. Never synthesize authorization
// or replay a minimal cookie-only request, and never retrieve attestation bodies.
export async function collectMusicCatalog(contents, section, isCurrent = () => true) {
  const items = new Map(), pending = new Set(), reads = new Set();
  let latestHasMore, responseFailed = false, revision = 0;
  const add = values => {
    for (const item of values) if (items.has(item.id) || items.size < 1000) {
      const previous = items.get(item.id);
      // Rendered cards can omit metadata already present in a browse response.
      items.set(item.id, { ...item, ownerId: item.ownerId ?? previous?.ownerId ?? null });
    }
  };
  const assertCurrent = () => { if (!isCurrent()) throw new Error('The account changed. Refresh the library.'); };
  const observe = (_event, method, event) => {
    if (method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(event.request.url);
        if (url.hostname === 'music.youtube.com' && url.pathname === '/youtubei/v1/browse') pending.add(event.requestId);
      } catch {}
    } else if (method === 'Network.responseReceived') {
      try {
        const url = new URL(event.response.url);
        if (url.hostname === 'music.youtube.com' && url.pathname === '/youtubei/v1/browse') {
          pending.add(event.requestId);
          if (event.response.status !== 200) responseFailed = true;
        }
      } catch {}
    } else if (method === 'Network.loadingFailed') {
      if (pending.delete(event.requestId)) responseFailed = true;
    } else if (method === 'Network.loadingFinished' && pending.delete(event.requestId)) {
      const read = (async () => {
        try {
          const result = await contents.debugger.sendCommand('Network.getResponseBody', { requestId: event.requestId });
          const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body;
          const data = JSON.parse(body.replace(/^\)\]\}'\s*/, ''));
          if (data.error) { responseFailed = true; return; }
          if (isCurrent()) { add(parseMusicLibrary(data).items); latestHasMore = musicContinuations(data).length > 0; revision++; }
        } catch { responseFailed = true; }
      })();
      reads.add(read); void read.finally(() => reads.delete(read));
    }
  };
  contents.debugger.attach('1.3');
  contents.debugger.on('message', observe);
  try {
    const observerReady = contents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 16000000, maxResourceBufferSize: 8000000 });
    assertCurrent();
    const navigation = contents.loadURL(musicLibraryURL(section));
    await Promise.all([observerReady, navigation]);
    assertCurrent();

    const began = Date.now(); let last, unchanged = 0, previous = '', exhausted = false;
    while (Date.now() - began < 18000 && items.size < 1000) {
      assertCurrent();
      if (contents.isDestroyed()) throw new Error('The music collection was interrupted. Try refreshing.');
      if (!contents.getURL().startsWith('https://music.youtube.com/')) throw Object.assign(new Error('Sign in to YouTube Music to browse your playlists and mixes.'), { code: 'SIGN_IN_REQUIRED' });
      last = await contents.executeJavaScript(snapshotScript);
      add(last.items);
      if (last.ready) {
        const signature = `${items.size}:${last.height}:${revision}`;
        unchanged = signature === previous && !pending.size && !reads.size ? unchanged + 1 : 0;
        previous = signature;
        // Scroll the site's actual content scroller; it owns continuation tokens
        // and the authenticated transport. Require settling before declaring done.
        if (unchanged >= 3 && !(latestHasMore ?? last.hasMore)) { exhausted = true; break; }
        await contents.executeJavaScript(scroll);
      }
      await pause(400);
    }
    await Promise.allSettled([...reads]);
    assertCurrent();
    if (!last?.ready && !items.size) throw new Error('YouTube could not load this music listing. Try refreshing.');
    return { items: [...items.values()], signedIn: last?.signedIn === true,
      partial: !exhausted || responseFailed || pending.size > 0 || items.size >= 1000 };
  } finally {
    contents.debugger.removeListener('message', observe);
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
  }
}
