// Project only public card metadata, in provider order, including its top card.
// Self-contained so the cached-view fallback can run it inside the Music page.
export function parseMixedMusicSearch(data) {
  const items=[],seen=new Map(),visited=new WeakSet();let nodes=0;
  const text=value=>typeof value==='string'?value:value?.simpleText??value?.content??value?.runs?.map(run=>run.text??'').join('')??'';
  function card(row,top=false){
    const titleData=row.title??row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
    const endpoint=row.navigationEndpoint??titleData?.runs?.[0]?.navigationEndpoint??row.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
    const browse=endpoint?.browseEndpoint,watch=endpoint?.watchEndpoint;
    const pageType=browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType??'';
    const videoType=watch?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType??'';
    if(/PODCAST|EPISODE/.test(pageType+' '+videoType))return;
    const kind=pageType==='MUSIC_PAGE_TYPE_ARTIST'?'artist':pageType==='MUSIC_PAGE_TYPE_ALBUM'?'album':pageType==='MUSIC_PAGE_TYPE_USER_CHANNEL'?'profile':browse?.browseId?.startsWith('VL')||endpoint?.watchPlaylistEndpoint?'playlist':videoType==='MUSIC_VIDEO_TYPE_ATV'?'song':['MUSIC_VIDEO_TYPE_OMV','MUSIC_VIDEO_TYPE_UGC'].includes(videoType)?'video':null;
    if(!kind)return;
    const id=['artist','album','profile'].includes(kind)?browse?.browseId:kind==='playlist'?(browse?.browseId?.slice(2)??endpoint?.watchPlaylistEndpoint?.playlistId):watch?.videoId??row.playlistItemData?.videoId;
    const title=text(titleData);if(!id||!title)return;
    const subtitle=text(row.subtitle??row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text);
    const thumbnail=(row.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail??row.thumbnail?.musicThumbnailRenderer?.thumbnail??row.thumbnail)?.thumbnails?.at(-1)?.url;
    const item={id,title,kind,subtitle,source:'music',...(top?{topResult:true}:{}),...(thumbnail?{thumbnail}:{})};
    const runs=[row.subtitle,...(row.flexColumns??[]).slice(1).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text)].flatMap(v=>v?.runs??[]);
    for(const [field,type]of [['artist','MUSIC_PAGE_TYPE_ARTIST'],['album','MUSIC_PAGE_TYPE_ALBUM']]){
      const names=runs.filter(r=>r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType===type).map(r=>r.text).filter(v=>typeof v==='string');if(names.length)item[field]=[...new Set(names)].join(', ');
    }
    if(kind==='song'||kind==='video'){
      const length=text(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
      item.duration=/^\d+(?::\d{2}){1,2}$/.test(length)?length.split(':').reduce((sum,part)=>sum*60+Number(part),0):0;item.start=0;
    } else if(kind==='playlist')item.seed=watch?.videoId??null;
    if(seen.has(kind+':'+id)){const previous=seen.get(kind+':'+id);for(const key of ['thumbnail','artist','album','subtitle'])if(!previous[key]&&item[key])previous[key]=item[key];}
    else{seen.set(kind+':'+id,item);items.push(item);}
  }
  function walk(value,depth=0){
    if(!value||typeof value!=='object'||depth>35||visited.has(value)||++nodes>40000)return;visited.add(value);
    if(value.musicCardShelfRenderer){const shelf=value.musicCardShelfRenderer;card(shelf,true);walk(shelf.contents,depth+1);return;}
    if(value.musicResponsiveListItemRenderer){card(value.musicResponsiveListItemRenderer);return;}
    if(value.musicTwoRowItemRenderer){card(value.musicTwoRowItemRenderer);return;}
    for(const [key,child]of Object.entries(value))if(!['menu','responseContext','trackingParams','clickTrackingParams'].includes(key))walk(child,depth+1);
  }
  walk(data);return items.slice(0,500);
}
export function musicResultURL(item) {
  if(!['artist','album','profile'].includes(item?.kind)||!/^[-\w]{2,150}$/.test(item?.id??''))throw Error('Invalid Music result');
  return `https://music.youtube.com/browse/${encodeURIComponent(item.id)}`;
}
