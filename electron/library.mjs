import { BrowserWindow, WebContentsView, session } from 'electron';
import { YOUTUBE_PARTITION, isAccountURL, isYouTubeURL } from './contracts.mjs';
import { accountSnapshot, accountStatusScript } from './account.mjs';
import { parsePlaylistTracks, musicLibraryURL, playlistURL } from '../src/library-data.js';
import { discoverMusicPlaylists } from '../music-query.mjs';
import { collectMusicCatalog } from './music-catalog.mjs';
import { PlaylistCache } from '../src/playlist-cache.js';

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
const scrollScript = `(()=>{window.scrollTo(0,document.documentElement.scrollHeight);for(const node of document.querySelectorAll('ytmusic-player-queue #contents, ytmusic-app #content, ytmusic-app #layout, ytmusic-browse-response'))if(node.scrollHeight>node.clientHeight)node.scrollTop=node.scrollHeight;})()`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const signInError = () => Object.assign(new Error('Sign in to YouTube Music to browse your playlists and mixes.'), { code: 'SIGN_IN_REQUIRED' });

export function createMusicLibrary({ onIdentity = () => {} } = {}) {
  let work = Promise.resolve(), active, generation = 0;
  const cache = new PlaylistCache();
  const fetcher = (url, options) => session.fromPartition(YOUTUBE_PARTITION).fetch(url, options);

  function invalidate() { generation++; cache.clear(); active?.webContents?.stop(); }
  async function page(url, script, key) {
    const target = new URL(url);
    const version = generation;
    const task = async () => {
      if (version !== generation) throw new Error('The account changed. Refresh the library.');
      const cached = cache.get(key);
      if (cached) return cached;
      const options = { partition: YOUTUBE_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false };
      const probe = ['mine', 'mixes', 'home'].includes(key)
        ? new BrowserWindow({ show: false, width: 1100, height: 850, webPreferences: options })
        : new WebContentsView({ webPreferences: options });
      active = probe;
      probe.setBounds({ x: 0, y: 0, width: 1100, height: 850 });
      const contents = probe.webContents;
      contents.setAudioMuted(true);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      const guard = (event, target, _inPlace, main) => { if (event.isMainFrame !== false && main !== false && !isAccountURL(target)) event.preventDefault(); };
      contents.on('will-navigate', guard); contents.on('will-redirect', guard);
      const timer = setTimeout(() => { if (!contents.isDestroyed()) contents.close(); }, 35000);
      try {
        if (['mine', 'mixes', 'home'].includes(key)) {
          const result = await collectMusicCatalog(contents, key === 'home' ? 'discover' : key, () => version === generation);
          if (!result.signedIn && key !== 'home') throw signInError();
          const identity = accountSnapshot(await contents.executeJavaScript(accountStatusScript));
          if (version !== generation) throw new Error('The account changed. Refresh the library.');
          if (identity.status !== 'unknown') onIdentity(identity);
          if (version !== generation) throw new Error('The account changed. Refresh the library.');
          cache.set(key, result);
          return result;
        }
        await contents.loadURL(target.href);
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
            if (stale >= 6 && Date.now() - start >= 4000 || collected.size >= (last.tracks ? 500 : 1000)) break;
            await contents.executeJavaScript(scrollScript);
          }
          lastHeight = last.height;
          await delay(450);
        }
        if (version !== generation) throw new Error('The account changed. Refresh the library.');
        if (!last?.ready) throw new Error('YouTube could not load this music listing. Try refreshing.');
        let partial = last.partial === true || Date.now() - start >= 18000;
        if (version !== generation) throw new Error('The account changed. Refresh the library.');
        const result = { ...last, [last.tracks ? 'tracks' : 'items']: [...collected.values()], partial };
        if (key === 'mine' || key === 'home') {
          const identity = accountSnapshot(await contents.executeJavaScript(accountStatusScript));
          if (version !== generation) throw new Error('The account changed. Refresh the library.');
          if (identity.status !== 'unknown') onIdentity(identity);
        }
        if (version !== generation) throw new Error('The account changed. Refresh the library.');
        if (!last.tracks || result.tracks.length) cache.set(key, result);
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
      const version = generation;
      const cached = !refresh && cache.get(`catalog:${section}`);
      if (cached) return cached;
      const key = section === 'discover' ? 'home' : section;
      if (refresh) cache.clear();
      const result = await page(url, null, key);
      if (!result.signedIn && section === 'discover') {
        const data = await discoverMusicPlaylists({ fetcher, signal: AbortSignal.timeout(30000) });
        if (version !== generation) throw new Error('The account changed. Refresh the library.');
        cache.set(`catalog:${section}`, data); return data;
      }
      // Membership comes from the requested collection, not translated shelf titles.
      // Discovery keeps all playlist cards in Home, including mixes. Further source
      // filters can be added after the user reviews this broader feed.
      const data = { items: result.items, partial: result.partial };
      if (version !== generation) throw new Error('The account changed. Refresh the library.');
      cache.set(`catalog:${section}`, data); return data;
    },
    async playlist(value) {
      const url = playlistURL(value);
      const result = await page(url, `(${readRenderedPlaylist.toString()})(${parsePlaylistTracks.toString()})`, `playlist:${value.source === 'music' ? 'music' : 'youtube'}:${value.id}:${value.seed ?? ''}`);
      if (!result.tracks.length) throw new Error('This playlist is empty or unavailable to your account.');
      return { tracks: result.tracks.slice(0, 500), ids: result.tracks.slice(0, 500).map(track => track.id), partial: result.partial || result.tracks.length > 500 };
    },
  };
}
