import { WebContentsView } from 'electron';
import { YOUTUBE_PARTITION, isAccountURL, isYouTubeURL } from './contracts.mjs';
import { accountSnapshot, accountStatusScript } from './account.mjs';
import { parseMusicLibrary, parsePlaylistTracks, musicLibraryURL, playlistURL } from '../src/library-data.js';

function readRenderedLibrary(parse) {
  const roots = [...document.querySelectorAll('ytmusic-section-list-renderer, ytmusic-grid-renderer, ytmusic-shelf-renderer, ytmusic-carousel-shelf-renderer')].filter(node => node.data).map(node => node.localName === 'ytmusic-carousel-shelf-renderer' ? { musicCarouselShelfRenderer: node.data } : node.localName === 'ytmusic-shelf-renderer' ? { musicShelfRenderer: node.data } : node.data);
  if (!roots.length) for (const node of document.querySelectorAll('ytmusic-two-row-item-renderer')) if (node.data) roots.push({ musicTwoRowItemRenderer: node.data });
  const loggedIn = globalThis.ytcfg?.get?.('LOGGED_IN');
  const signedIn = typeof loggedIn === 'boolean' ? loggedIn : Boolean(document.querySelector('ytmusic-nav-bar #avatar-btn, ytmusic-nav-bar img[alt="Avatar image"]'));
  const result = parse(roots, 'mine');
  return { ...result, signedIn, ready: roots.length > 0 || Boolean(document.querySelector('ytmusic-browse-response, ytmusic-library-landing-page-renderer')), height: document.documentElement.scrollHeight };
}
function readRenderedPlaylist(parse) {
  const roots = [globalThis.ytInitialData?.contents];
  for (const node of document.querySelectorAll('ytmusic-playlist-shelf-renderer')) if (node.data) { roots.push(node.data); if (Array.isArray(node.data.contents)) roots.push({ musicPlaylistShelfRenderer: node.data }); }
  for (const node of document.querySelectorAll('ytmusic-player-queue')) if (node.data) { roots.push(node.data); if (Array.isArray(node.data.contents)) roots.push({ playlistPanelRenderer: node.data }); }
  const rows = [...document.querySelectorAll('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer')].filter(node => node.data).map(node => ({ musicResponsiveListItemRenderer: node.data }));
  if (rows.length) roots.push({ musicPlaylistShelfRenderer: { contents: rows } });
  const queue = [...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')].filter(node => node.data).map(node => node.data.videoId ? { playlistPanelVideoRenderer: node.data } : node.data);
  if (queue.length) roots.push({ playlistPanelRenderer: { contents: queue } });
  const result = parse(roots);
  return { ...result, ready: result.tracks.length > 0 || Boolean(document.querySelector('ytmusic-message-renderer, ytd-background-promo-renderer, ytd-alert-with-button-renderer')), height: document.documentElement.scrollHeight };
}
const scrollScript = `(()=>{window.scrollTo(0,document.documentElement.scrollHeight);for(const node of document.querySelectorAll('ytmusic-player-queue #contents, ytmusic-app #layout, ytmusic-browse-response'))if(node.scrollHeight>node.clientHeight)node.scrollTop=node.scrollHeight;})()`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const signInError = () => new Error('Sign in to YouTube Music to browse your playlists and mixes.');

export function createMusicLibrary({ onIdentity = () => {} } = {}) {
  let work = Promise.resolve(), active, generation = 0;
  const cache = new Map();
  function invalidate() { generation++; cache.clear(); active?.webContents?.stop(); }
  async function page(url, script, key) {
    const version = generation;
    const task = async () => {
      if (version !== generation) throw new Error('The account changed. Refresh the library.');
      if (cache.has(key) && Date.now() - cache.get(key).time < 60000) return cache.get(key).data;
      const probe = new WebContentsView({ webPreferences: { partition: YOUTUBE_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      active = probe;
      probe.setBounds({ x: 0, y: 0, width: 1100, height: 850 });
      const contents = probe.webContents;
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const guard = (event, target, _inPlace, main) => { if (event.isMainFrame !== false && main !== false && !isAccountURL(target)) event.preventDefault(); };
      contents.on('will-navigate', guard); contents.on('will-redirect', guard);
      const timer = setTimeout(() => { if (!contents.isDestroyed()) contents.close(); }, 22000);
      try {
        await contents.loadURL(url);
        if (!isYouTubeURL(contents.getURL())) throw signInError();
        const start = Date.now(), collected = new Map();
        let last, stale = 0, lastHeight = 0;
        while (Date.now() - start < 18000 && version === generation) {
          if (contents.isDestroyed() || !isYouTubeURL(contents.getURL())) throw signInError();
          last = await contents.executeJavaScript(script);
          const values = last.items ?? last.tracks;
          const before = collected.size;
          for (const item of values ?? []) if (collected.size < 1000) collected.set(item.id, item);
          if (last.ready) {
            if (last.signedIn === false && key === 'mine') throw signInError();
            if (collected.size === before && last.height === lastHeight) stale++; else stale = 0;
            if (stale >= 3 || collected.size >= (last.tracks ? 500 : 1000)) break;
            await contents.executeJavaScript(scrollScript);
          }
          lastHeight = last.height;
          await delay(450);
        }
        if (version !== generation) throw new Error('The account changed. Refresh the library.');
        if (!last?.ready) throw new Error('YouTube could not load this music listing. Try refreshing.');
        const result = { ...last, [last.tracks ? 'tracks' : 'items']: [...collected.values()], partial: last.partial === true };
        if (key === 'mine' || key === 'home') {
          const identity = accountSnapshot(await contents.executeJavaScript(accountStatusScript));
          if (identity.status !== 'unknown') onIdentity(identity);
          cache.set(key, { time: Date.now(), data: result });
        }
        return result;
      } catch (error) {
        if (error.code === 'ERR_ABORTED') throw new Error('The library request was interrupted. Refresh to try again.');
        if (error.code?.startsWith('ERR_') || typeof error.errno === 'number') throw new Error('YouTube could not load this music listing. Check your connection and refresh.');
        throw error;
      } finally {
        clearTimeout(timer);
        if (!contents.isDestroyed()) contents.close();
        if (active === probe) active = null;
      }
    };
    work = work.catch(() => {}).then(task);
    return work;
  }
  return {
    invalidate,
    async browse(section, refresh = false) {
      const url = musicLibraryURL(section);
      const key = section === 'mine' ? 'mine' : 'home';
      if (refresh) cache.delete(key);
      const result = await page(url, `(${readRenderedLibrary.toString()})(${parseMusicLibrary.toString()})`, key);
      if (section === 'mixes' && !result.signedIn) throw signInError();
      const items = result.items.filter(item => section === 'mine' || (section === 'mixes' ? item.kind === 'mix' : item.kind === 'playlist'));
      if (section === 'discover') items.sort((a, b) => Number(b.community) - Number(a.community));
      return { items, partial: result.partial };
    },
    async playlist(value) {
      const result = await page(playlistURL(value), `(${readRenderedPlaylist.toString()})(${parsePlaylistTracks.toString()})`, 'playlist');
      if (!result.tracks.length) throw new Error('This playlist is empty or unavailable to your account.');
      return { tracks: result.tracks.slice(0, 500), ids: result.tracks.slice(0, 500).map(track => track.id), partial: result.partial || result.tracks.length > 500 };
    },
  };
}
