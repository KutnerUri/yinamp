import { parseMixedMusicSearch } from '../src/search-all-data.js';
import { checkSearchItems, checkSearchStructure } from '../src/search-schema.js';
import { musicContinuations } from '../music-query.mjs';
import { matchingSearchRequest } from './search-request.mjs';
import { navigateMusicSearch, matchesSearchPage } from './search-navigation.mjs';
import { libraryCancelled } from './library-errors.mjs';

export async function collectUnfilteredSearch(contents,query,_category,pages,isCurrent,onMismatch=()=>{},onPage=()=>{}) {
  const items=new Map(),tokens=new Set(),pending=new Set();let active=true,count=0,more=false,error,wake;
  const current=()=>{if(!isCurrent())throw libraryCancelled();if(contents.isDestroyed())throw Error('The search window closed.');};
  const publish=()=>onPage({items:[...items.values()],partial:more});
  function accept(values,hasMore,source,structure){
    current();const clean=checkSearchItems(values,'all');
    for(const issue of [...(structure?.issues??[]),...clean.issues])onMismatch({category:'all',source,...issue});
    for(const item of clean.items){const key=item.kind+':'+item.id;const old=items.get(key);items.set(key,old?{...item,...old}:item);}
    count++;more=hasMore;publish();wake?.();
  }
  const observer=(_e,method,event)=>{
    if(!active)return;
    if(method==='Network.requestWillBeSent'&&count<pages&&matchingSearchRequest(event.request,query,'',tokens))pending.add(event.requestId);
    if(method==='Network.loadingFailed'&&pending.delete(event.requestId)){error=Error('YouTube Music search request failed.');wake?.();}
    if(method==='Network.responseReceived'&&pending.has(event.requestId)&&event.response.status!==200){error=Error('YouTube Music search request failed.');wake?.();}
    if(method==='Network.loadingFinished'&&pending.delete(event.requestId))void(async()=>{
      try{
        const body=await contents.debugger.sendCommand('Network.getResponseBody',{requestId:event.requestId});if(!active)return;
        const data=JSON.parse((body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body).replace(/^\)\]\}'\s*/,''));if(data.error)throw Error('YouTube Music search response failed.');
        const next=musicContinuations(data);for(const token of next)tokens.add(token);
        accept(parseMixedMusicSearch(data),next.length>0,'response',checkSearchStructure(data));
      }catch(failure){if(active){error=failure;wake?.();}}
    })();
  };
  contents.debugger.attach('1.3');contents.debugger.on('message',observer);
  try{
    const enabled=contents.debugger.sendCommand('Network.enable',{maxTotalBufferSize:16000000,maxResourceBufferSize:8000000});
    if(!contents.getURL()||contents.getURL()==='about:blank') await Promise.all([enabled,navigateMusicSearch(contents,query,isCurrent)]);
    else { await enabled; await navigateMusicSearch(contents,query,isCurrent); }
    const began=Date.now();let scrolled=0,lastSize=-1;
    while(Date.now()-began<12000){
      current();if(error)throw error;if(count>=pages||count&&!more)break;
      if(!pending.size){
        const cached=await contents.executeJavaScript(`(()=>{
          const parseMixedMusicSearch=${parseMixedMusicSearch.toString()},musicContinuations=${musicContinuations.toString()},checkSearchStructure=${checkSearchStructure.toString()};
          const root=document.querySelector('ytmusic-search-page:not([hidden])');if(!root)return null;
          const correct=[...root.querySelectorAll('ytmusic-chip-cloud-chip-renderer')].some(node=>(node.data??node.__data?.data)?.navigationEndpoint?.searchEndpoint?.query===${JSON.stringify(query)});
          if(!correct)return null;
          const data=root.data??root.__data?.data;
          const empty=[...root.querySelectorAll('ytmusic-message-renderer')].some(n=>n.getClientRects().length);
          return {structure:checkSearchStructure(data),items:parseMixedMusicSearch(data),more:musicContinuations(data).length>0,ready:!!root.querySelector('ytmusic-card-shelf-renderer,ytmusic-responsive-list-item-renderer')||empty};
        })()`);
        if(cached?.ready&&matchesSearchPage(contents.getURL(),query)&&(!count||scrolled===count&&cached.items.length>lastSize)){
          lastSize=cached.items.length;accept(cached.items,cached.more,'cached-page',cached.structure);
          if(count>=pages||!more)break;
        }
        if(count&&more&&scrolled<count){await contents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`);scrolled=count;}
      }
      await new Promise(resolve=>{const timer=setTimeout(done,100);function done(){clearTimeout(timer);if(wake===done)wake=null;resolve();}wake=done;});
    }
    current();if(error)throw error;if(!count)throw Object.assign(Error('Unfiltered results did not become ready.'),{code:'SEARCH_RESULTS_TIMEOUT'});
    return {items:[...items.values()],partial:more};
  }finally{active=false;wake?.();contents.debugger.removeListener('message',observer);if(!contents.isDestroyed()&&contents.debugger.isAttached())contents.debugger.detach();}
}
