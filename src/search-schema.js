// Expected projection of Music search data. Only consumed fields are checked;
// missing optional metadata is valid. Reports contain shapes, never field values.
export function checkSearchItems(values, category) {
  const items = [], issues = [];
  const report = (index, field, expected, actual) => issues.push({ index, field, expected, actual: actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual });
  if (!Array.isArray(values)) return { items, issues: [{ field: 'items', expected: 'array', actual: typeof values }] };
  for (const [index, value] of values.entries()) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) { report(index, 'item', 'object', value); continue; }
    const item = {};
    if (typeof value.id !== 'string' || !(['song','video'].includes(value.kind) ? /^[\w-]{11}$/ : /^[\w-]{2,150}$/).test(value.id)) { report(index, 'id', ['song','video'].includes(value.kind) ? '11-character video ID' : 'provider browse/playlist ID', value.id); continue; }
    if (typeof value.title !== 'string' || !value.title.trim()) { report(index, 'title', 'nonempty string', value.title); continue; }
    if (!(category === 'all' ? ['song','video','playlist','artist','album','profile'].includes(value.kind) : category === 'songs' ? value.kind === 'song' : ['playlist','mix'].includes(value.kind))) { report(index, 'kind', category === 'all' ? 'supported Music result type' : category === 'songs' ? 'song' : 'playlist or mix', value.kind); continue; }
    if(value.topResult===true)item.topResult=true;
    item.id = value.id; item.title = value.title.slice(0, 300); item.kind = value.kind;
    for (const field of ['artist', 'album', 'subtitle', 'source']) if (value[field] !== undefined && value[field] !== null) {
      if (typeof value[field] === 'string') item[field] = value[field].slice(0, 300); else report(index, field, 'string', value[field]);
    }
    if (value.thumbnail) {
      try { const url = new URL(value.thumbnail); if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'music.youtube.com' && url.pathname === '/image/mixart' || ['.ytimg.com','.googleusercontent.com','.ggpht.com','.gstatic.com'].some(host=>url.hostname.endsWith(host)))) throw Error(); item.thumbnail = url.href; }
      catch { report(index, 'thumbnail', 'supported HTTPS artwork URL', value.thumbnail); }
    }
    for (const field of ['duration', 'start']) if (value[field] !== undefined) { if (Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 604800) item[field] = value[field]; else report(index, field, 'nonnegative bounded number', value[field]); }
    for (const [field, pattern] of [['ownerId', /^UC[\w-]{22}$/], ['seed', /^[\w-]{11}$/]]) if (value[field] != null) { if (typeof value[field] === 'string' && pattern.test(value[field])) item[field] = value[field]; else report(index, field, 'provider ID', value[field]); }
    if (value.versions && typeof value.versions === 'object') {
      const versions = {};
      for (const type of ['song','video']) if (value.versions[type]) { const v=value.versions[type]; if (/^[\w-]{11}$/.test(v.id ?? '') && Number.isFinite(v.duration) && v.duration >= 0) versions[type]={id:v.id,duration:v.duration}; else report(index, `versions.${type}`, 'video ID and duration', v); }
      if (Object.keys(versions).length) item.versions=versions;
    }
    items.push(item);
  }
  return { items, issues: issues.slice(0, 100) };
}

export function checkSearchStructure(data) {
  const issues=[], seen=new WeakSet(); let rows=0, nodes=0;
  const text=value=>value?.simpleText ?? value?.runs?.map(r=>r.text??'').join('');
  function walk(value,depth=0){
    if(!value||typeof value!=='object'||depth>35||seen.has(value)||++nodes>40000)return;
    seen.add(value);
    if (value.musicShelfRenderer) {
      const contents=value.musicShelfRenderer.contents;
      if (!Array.isArray(contents)) issues.push({field:'musicShelfRenderer.contents',expected:'array',actual:typeof contents});
      else for(const entry of contents) if(!entry || typeof entry!=='object' || !['musicResponsiveListItemRenderer','musicTwoRowItemRenderer','continuationItemRenderer'].some(key=>entry[key])) issues.push({field:'musicShelfRenderer.contents[]',expected:'supported result or continuation renderer',actual:'unrecognized entry'});
    }
    for(const key of ['musicResponsiveListItemRenderer','musicTwoRowItemRenderer','musicCardShelfRenderer']) if(value[key]){
      const row=value[key];rows++;
      if(!row || typeof row!=='object'){issues.push({field:key,expected:'object',actual:typeof row});continue;}
      const title=row.title??row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text;
      if(typeof text(title)!=='string')issues.push({field:`${key}.title`,expected:'text runs or simpleText',actual:typeof title});
      const thumbnail=row.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail??row.thumbnail?.musicThumbnailRenderer?.thumbnail??row.thumbnail;
      if (Array.isArray(thumbnail?.thumbnails)) for (const image of thumbnail.thumbnails) {
        try { const url = new URL(image?.url); if (typeof image?.url !== 'string' || url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'music.youtube.com' && url.pathname === '/image/mixart' || ['.ytimg.com','.googleusercontent.com','.ggpht.com','.gstatic.com'].some(host=>url.hostname.endsWith(host)))) throw Error(); }
        catch { issues.push({field:`${key}.thumbnail.thumbnails[].url`,expected:'supported HTTPS artwork URL',actual:typeof image?.url}); }
      }
      if(thumbnail && !Array.isArray(thumbnail.thumbnails))issues.push({field:`${key}.thumbnail`,expected:'thumbnails array',actual:'unrecognized object'});
    }
    for(const [key,child] of Object.entries(value))if(!['menu','responseContext','trackingParams','clickTrackingParams'].includes(key))walk(child,depth+1);
  }
  walk(data);
  if(nodes>40000)issues.push({field:'response',expected:'bounded result tree',actual:'node limit exceeded'});
  if(rows===0 && data && !Array.isArray(data) && typeof data==='object' && !['contents','continuationContents','onResponseReceivedCommands','onResponseReceivedActions'].some(key=>key in data)) issues.push({field:'response',expected:'search contents or continuation envelope',actual:'unrecognized envelope'});
  if(!data||typeof data!=='object')issues.push({field:'response',expected:'object or array',actual:typeof data});
  return {rows,issues:issues.slice(0,100)};
}

export function mergeSearchItem(previous, next) {
  const merged = { ...previous, ...next };
  // An incomplete rendered copy must not erase richer provider metadata.
  for (const field of ['thumbnail','artist','album','subtitle','ownerId','seed']) if (!next[field] && previous?.[field]) merged[field]=previous[field];
  return merged;
}
