import { parseMusicLibrary, musicSongItems, parseMusicSongs, parsePlaylistTracks } from '../src/library-data.js';
import { musicContinuations } from '../music-query.mjs';
import { checkSearchItems, checkSearchStructure, mergeSearchItem } from '../src/search-schema.js';
import { libraryCancelled } from './library-errors.mjs';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// The category prefix identifies the observed category; the whole returned
// command, including its changing suffix, is executed by the actual client.
const prefixes = { songs: 'EgWKAQII', community: 'EgeKAQQoAEAB', featured: 'EgeKAQQoADgB' };
export async function collectMusicSearch(contents, query, category, pages, isCurrent, onMismatch = () => {}) {
  const url = new URL('https://music.youtube.com/search'); url.searchParams.set('q', query);
  if (contents.isDestroyed()) throw new Error('The search window closed.');
  const previous = new URL(contents.getURL() || 'about:blank');
  if (previous.origin !== url.origin || previous.pathname !== url.pathname || previous.searchParams.get('q') !== query) await contents.loadURL(url.href);
  else await contents.executeJavaScript(`(()=>{const node=document.querySelector('ytmusic-app #content');if(node)node.scrollTop=0;})()`);
  const assertCurrent = () => {
    if (!isCurrent()) throw libraryCancelled();
    if (contents.isDestroyed()) throw new Error('The search window closed.');
    const current = new URL(contents.getURL());
    if (current.origin !== url.origin || current.pathname !== url.pathname || current.searchParams.get('q') !== query) throw new Error('The search window left the requested search.');
  };
  let params;
  for (let i = 0; i < 30 && !params; i++) {
    assertCurrent();
    params = await contents.executeJavaScript(`(()=>{const root=document.querySelector('ytmusic-search-page:not([hidden])');return [...(root?.querySelectorAll('ytmusic-chip-cloud-chip-renderer')??[])].map(n=>(n.data??n.__data?.data)?.navigationEndpoint?.searchEndpoint?.params).find(p=>p?.startsWith(${JSON.stringify(prefixes[category])}));})()`);
    if (!params) await wait(200);
  }
  if (!params) throw new Error('YouTube Music did not provide the requested search category. Try again.');
  const items = new Map(), reads = new Set(), pending = new Set();
  let networkResponses = 0;
  const reported = new Set();
  function checked(values, source, structure) {
    const result = checkSearchItems(values, category);
    const issues = [...(structure?.issues ?? []), ...result.issues];
    if (structure?.rows && !result.items.length) issues.push({ field: 'results', expected: 'recognized entries in selected category', actual: 'populated rows with no valid entries' });
    for (const issue of issues) { const key=JSON.stringify([source,issue.field,issue.expected,issue.actual]); if(!reported.has(key)){reported.add(key);onMismatch({category,source,...issue});} }
    return result.items;
  }
  let responses = 0, hasMore = false, failed = false;
  const observer = (_event, method, event) => {
    if (method === 'Network.requestWillBeSent') {
      try {
        const url = new URL(event.request.url);
        if (url.hostname === 'music.youtube.com' && url.pathname === '/youtubei/v1/search') {
          const body = JSON.parse(event.request.postData || '{}');
          if (body.params === params || responses > 0 && (body.continuation || url.searchParams.has('continuation') || url.searchParams.has('ctoken'))) pending.add(event.requestId);
        }
      } catch {}
    }
    if (method === 'Network.responseReceived' && pending.has(event.requestId) && event.response.status !== 200) failed = true;
    if (method === 'Network.loadingFailed' && pending.delete(event.requestId)) failed = true;
    if (method !== 'Network.loadingFinished' || !pending.delete(event.requestId)) return;
    const read = (async () => {
      try {
        const body = await contents.debugger.sendCommand('Network.getResponseBody', { requestId: event.requestId });
        const data = JSON.parse((body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body).replace(/^\)\]\}'\s*/, ''));
        if (data.error) throw new Error();
        assertCurrent();
        const values = category === 'songs'
          ? musicSongItems(data)
          : parseMusicLibrary(data).items;
        const valid=checked(values, 'response', checkSearchStructure(data));
        if (!networkResponses) { for (const id of items.keys()) if(!valid.some(item=>item.id===id))items.delete(id); }
        for (const item of valid) if (items.size < 500) items.set(item.id, mergeSearchItem(items.get(item.id), item));
        networkResponses++;
        hasMore = musicContinuations(data).length > 0; responses++;
      } catch (error) { if (error instanceof SyntaxError) onMismatch({ category, source: 'response', field: 'response', expected: 'valid JSON', actual: 'invalid JSON' }); failed = true; }
    })();
    reads.add(read); void read.finally(() => reads.delete(read));
  };
  contents.debugger.attach('1.3'); contents.debugger.on('message', observer);
  try {
    await contents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 16000000, maxResourceBufferSize: 8000000 });
    await contents.executeJavaScript(`(()=>{const root=document.querySelector('ytmusic-search-page:not([hidden])');const chip=[...root.querySelectorAll('ytmusic-chip-cloud-chip-renderer')].find(n=>(n.data??n.__data?.data)?.navigationEndpoint?.searchEndpoint?.params===${JSON.stringify(params)});if(!chip)throw Error('Search category disappeared');chip.click();})()`, true);
    const began = Date.now(); let scrolled = 0, settled = 0, previous = -1;
    while (Date.now() - began < 15000) {
      assertCurrent();
      const rendered = await contents.executeJavaScript(`(()=>{
        const parseMusicLibrary=${parseMusicLibrary.toString()}, parseMusicSongs=${parseMusicSongs.toString()}, parsePlaylistTracks=${parsePlaylistTracks.toString()}, musicSongItems=${musicSongItems.toString()}, musicContinuations=${musicContinuations.toString()},checkSearchStructure=${checkSearchStructure.toString()};
        const root=document.querySelector('ytmusic-search-page:not([hidden])');
        const selected=[...(root?.querySelectorAll('ytmusic-chip-cloud-chip-renderer')??[])].some(n=>{const d=n.data??n.__data?.data;return d?.isSelected&&d.navigationEndpoint?.searchEndpoint?.params?.startsWith(${JSON.stringify(prefixes[category])});});
        if(!selected)return null;
        const roots=[...root.querySelectorAll('ytmusic-shelf-renderer')].filter(n=>n.getClientRects().length).map(n=>({musicShelfRenderer:n.data??n.__data?.data}));
        return {structure:checkSearchStructure(roots),items:${category === 'songs' ? 'musicSongItems(roots)' : 'parseMusicLibrary(roots).items'},hasMore:musicContinuations(roots).length>0,ready:roots.length>0};
      })()`);
      if (rendered?.ready && !networkResponses && !pending.size && !reads.size) {
        const before=items.size;
        for(const item of checked(rendered.items, 'cached-page', rendered.structure)) if(items.size<500)items.set(item.id,mergeSearchItem(items.get(item.id),item));
        if(!responses) {responses=1;hasMore=rendered.hasMore;}
        else if(scrolled===responses && items.size>before && !pending.size && !reads.size) {responses++;hasMore=rendered.hasMore;}
      }
      if (failed) throw new Error('YouTube Music search could not load. Try again.');
      if (responses && !pending.size && !reads.size) {
        settled = previous === responses ? settled + 1 : 0; previous = responses;
        if (settled >= 2) {
          if (!hasMore || responses >= pages) break;
          if (scrolled < responses) {
            await contents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`); scrolled = responses;
          }
        }
      }
      await wait(250);
    }
    await Promise.allSettled([...reads]); assertCurrent();
    if (!responses) throw new Error('YouTube Music search took too long. Try again.');
    return { items: [...items.values()], partial: hasMore || Boolean(pending.size) };
  } finally {
    contents.debugger.removeListener('message', observer);
    if (!contents.isDestroyed() && contents.debugger.isAttached()) contents.debugger.detach();
  }
}
