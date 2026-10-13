import { libraryCancelled } from './library-errors.mjs';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function matchesSearchPage(value, query) {
  try { const url=new URL(value); return url.origin==='https://music.youtube.com' && url.pathname==='/search' && url.searchParams.get('q')===query; } catch { return false; }
}

// Use the site's search component, not synthetic authentication or copied
// navigation commands. Its private methods can change: failure is bounded and
// the window owner retries on a fresh client using the normal startup load.
export async function navigateMusicSearch(contents, query, isCurrent, { timeout = 6000, wait = sleep } = {}) {
  const assertCurrent = () => { if (!isCurrent()) throw libraryCancelled(); if(contents.isDestroyed())throw new Error('The search window closed.'); };
  assertCurrent();
  const previous=contents.getURL();
  if (!previous || previous==='about:blank') {
    const url=new URL('https://music.youtube.com/search');url.searchParams.set('q',query);
    await contents.loadURL(url.href);assertCurrent();return 'initial';
  }
  if (matchesSearchPage(previous,query)) return 'same-query';
  if (!previous.startsWith('https://music.youtube.com/search?')) throw new Error('The search client left its search page.');
  const submitted=await contents.executeJavaScript(`(()=>{
    const box=document.querySelector('ytmusic-search-box');
    if(typeof box?.setQuery!=='function'||typeof box?.navigateToQueryResults!=='function')return false;
    box.setQuery(${JSON.stringify(query)});box.navigateToQueryResults(${JSON.stringify(query)});return true;
  })()`,true);
  if (!submitted) throw new Error('YouTube Music search controls changed.');
  const began=Date.now();
  while(Date.now()-began<timeout){
    assertCurrent();
    if(matchesSearchPage(contents.getURL(),query)) {
      const ready=await contents.executeJavaScript(`(()=>{
        const root=document.querySelector('ytmusic-search-page:not([hidden])');
        return [...(root?.querySelectorAll('ytmusic-chip-cloud-chip-renderer')??[])].some(node=>{
          const endpoint=(node.data??node.__data?.data)?.navigationEndpoint?.searchEndpoint;
          return endpoint?.query===${JSON.stringify(query)}&&typeof endpoint.params==='string';
        });
      })()`);
      if(ready)return 'internal';
    }
    await wait(100);
  }
  throw new Error('YouTube Music did not complete the internal search navigation.');
}
