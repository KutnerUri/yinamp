import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { analyzeOwners } from './owner-probe.mjs';
import { analyzeMusicData, requestSummary, decodeRequestPayload } from './analyze.mjs';
import { parseMusicLibrary } from '../../src/library-data.js';
import { isAccountURL } from '../../electron/contracts.mjs';

app.setName('Yinamp');
console.log('Source lab: main module loaded.');
const directory = fileURLToPath(new URL('.', import.meta.url));
const profile = process.argv.find(value => value.startsWith('--profile='));
if (!profile) throw new Error('Run this prototype through npm run prototype.');
app.setPath('userData', resolve(profile.slice('--profile='.length)));
const automatic = process.argv.includes('--auto');
const reports = join(directory, 'reports');
const report = { version: 1, startedAt: new Date().toISOString(), mode: 'app-session-snapshot', requests: [], pages: [], experiments: [] };
const pending = new Map();
let panel, music, busy = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let pageStarted = 0, stage = 'home';

function publish() {
  if (panel && !panel.isDestroyed()) panel.webContents.send('source-lab:update', report);
}
async function save() {
  await mkdir(reports, { recursive: true });
  await writeFile(join(reports, 'latest.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
}
function observe(contents) {
  contents.debugger.attach('1.3');
  contents.debugger.on('message', async (_event, method, data) => {
    if (method === 'Network.requestWillBeSent') {
      const payload = !/\/youtubei\/v1\/(browse|search|next)(?:\?|$)/.test(data.request.url) ? {} : decodeRequestPayload(data.request);
      let summary; try { summary = requestSummary(data.request.url, payload.body, data.type); } catch {}
      if (!summary) return;
      const record = { ...summary, method: data.request.method, contentType: payload.contentType, encoding: payload.encoding, hasPostData: Boolean(data.request.hasPostData), stage, started: Date.now(), status: null };
      pending.set(data.requestId, record); report.requests.push(record); publish();
      if (data.request.hasPostData && !data.request.postData && ['/youtubei/v1/browse', '/youtubei/v1/search', '/youtubei/v1/next'].includes(summary.endpoint)) {
        void contents.debugger.sendCommand('Network.getRequestPostData', { requestId: data.requestId }).then(value => {
          Object.assign(record, requestSummary(data.request.url, value.postData, data.type)); publish();
        }).catch(() => { record.postDataUnavailable = true; });
      }
    } else if (method === 'Network.responseReceived') {
      const record = pending.get(data.requestId); if (record) record.status = data.response.status;
    } else if (method === 'Network.loadingFinished') {
      const record = pending.get(data.requestId); if (!record) return;
      pending.delete(data.requestId); record.durationMs = Date.now() - record.started; delete record.started;
      // Attestation is not catalog data. Never retrieve its response body.
      if (['/youtubei/v1/browse', '/youtubei/v1/search', '/youtubei/v1/next'].includes(record.endpoint)) {
        try {
          const result = await contents.debugger.sendCommand('Network.getResponseBody', { requestId: data.requestId });
          const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString() : result.body;
          const value = JSON.parse(body.replace(/^\)\]\}'\s*/, ''));
          record.catalog = analyzeMusicData(value);
          if (process.argv.includes('--owners')) record.owners = analyzeOwners(value);
          record.productionParser = { playlists: parseMusicLibrary(value).items.length, mixes: parseMusicLibrary(value, 'mixes').items.length };
        } catch { record.responseUnavailable = true; }
      }
      publish();
    } else if (method === 'Network.loadingFailed') {
      const record = pending.get(data.requestId); if (!record) return;
      pending.delete(data.requestId); record.failed = true; record.durationMs = Date.now() - record.started; delete record.started; publish();
    }
  });
  return contents.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 16000000, maxResourceBufferSize: 8000000, maxPostDataSize: 100000 });
}

// Inspect only rendered Music metadata. Do not touch auth pages, cookies, or account menus.
function readDOM() {
  const text = value => value?.simpleText ?? value?.runs?.map(run => run.text ?? '').join('') ?? '';
  const roots = [], actions = [], layout = [];
  const active = document.querySelector('ytmusic-browse-response:not([hidden])') ?? document.querySelector('ytmusic-app #content') ?? document; 
  const dataOf = node => node.data ?? node.__data?.data;
  for (const node of active.querySelectorAll('ytmusic-carousel-shelf-renderer,ytmusic-shelf-renderer,ytmusic-grid-renderer')) {
    if (!node.getClientRects().length) continue;
    const data = dataOf(node); layout.push({ tag: node.localName, hasData: Boolean(data), keys: Object.keys(data ?? {}).slice(0, 15) });
    if (!data) continue;
    roots.push(node.localName === 'ytmusic-carousel-shelf-renderer' ? { musicCarouselShelfRenderer: data } : node.localName === 'ytmusic-shelf-renderer' ? { musicShelfRenderer: data } : data);
    if (node.localName !== 'ytmusic-carousel-shelf-renderer') continue;
    const header = data.header?.musicCarouselShelfBasicHeaderRenderer ?? {};
    const button = node.querySelector('[id*=more] button,[id*=more] a,ytmusic-carousel-shelf-basic-header-renderer ytmusic-button-renderer button,ytmusic-carousel-shelf-basic-header-renderer ytmusic-button-renderer a');
    const command = header.moreContentButton?.buttonRenderer?.navigationEndpoint ?? header.moreContentButton?.buttonRenderer?.command;
    actions.push({ title: text(header.title), button, hasButton: Boolean(button), hasBrowseCommand: Boolean(command?.browseEndpoint), browseId: command?.browseEndpoint?.browseId, params: command?.browseEndpoint?.params, buttons: [...node.querySelectorAll('button')].slice(0, 6).map(value => value.getAttribute('aria-label') ?? value.textContent.trim()) });
  }
  globalThis.__yinampSourceLabActions = actions;
  return { roots, signedIn: globalThis.ytcfg?.get?.('LOGGED_IN') === true, layout,
    scrollers: [...document.querySelectorAll('ytmusic-app,ytmusic-app *')].filter(node => node.scrollHeight > node.clientHeight + 100 && /auto|scroll/.test(getComputedStyle(node).overflowY)).slice(0, 12).map(node => ({ tag: node.localName, id: node.id, height: node.scrollHeight, viewport: node.clientHeight, top: node.scrollTop })),
    renderedArtwork: [...active.querySelectorAll('ytmusic-two-row-item-renderer')].filter(n => n.getClientRects().length).map(n => ({ imageCount: n.querySelectorAll('img').length, images: [...n.querySelectorAll('img')].map(i => { try { const u = new URL(i.currentSrc || i.src, location.origin); return { host: u.hostname, staticPath: u.hostname === location.hostname || u.hostname.endsWith('gstatic.com') ? u.pathname : undefined, loaded: i.complete && i.naturalWidth > 0, width: i.naturalWidth }; } catch { return {}; } }), coverTags: [...n.querySelectorAll('*')].filter(e => /thumbnail|image|cover/.test(e.localName)).map(e => e.localName) })), actions: actions.map(({ button, ...value }, index) => ({ index, ...value })) };
}

async function snapshot() {
  if (!music.webContents.getURL().startsWith('https://music.youtube.com/')) return { signedIn: false, authPage: true };
  const dom = await music.webContents.executeJavaScript(`(${readDOM.toString()})()`);
  const page = { stage, elapsedMs: Date.now() - pageStarted, signedIn: dom.signedIn,
    catalog: analyzeMusicData(dom.roots), productionParser: { playlists: parseMusicLibrary(dom.roots).items.length, mixes: parseMusicLibrary(dom.roots, 'mixes').items.length },
    renderedArtwork: dom.renderedArtwork, actions: dom.actions, layout: dom.layout, scrollers: dom.scrollers };
  report.pages.push(page); publish(); await save(); return page;
}
async function ready() {
  const began = Date.now();
  while (Date.now() - began < 14000) {
    if (!music.webContents.getURL().startsWith('https://music.youtube.com/')) return;
    try { if (await music.webContents.executeJavaScript('Boolean(document.querySelector("ytmusic-carousel-shelf-renderer,ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer,ytmusic-navigation-button-renderer"))')) return; } catch {}
    await sleep(250);
  }
}
async function navigate(route, query = '') {
  const path = { home: '/', library: '/library/playlists', explore: '/explore', search: '/search' }[route];
  if (!path) throw new Error('Unknown experiment route.');
  const url = new URL(`https://music.youtube.com${path}`); url.searchParams.set('hl', 'en');
  if (route === 'search') url.searchParams.set('q', String(query).slice(0, 200));
  stage = route; pageStarted = Date.now();
  await music.loadURL(url.href); await ready(); return snapshot();
}
async function openSource(index) {
  if (!Number.isInteger(index) || index < 0 || index > 100) throw new Error('Select an available source.');
  const started = Date.now(), previous = report.pages.at(-1)?.actions[index];
  stage = `source:${index}`; pageStarted = started;
  const clicked = await music.webContents.executeJavaScript(`(()=>{const source=globalThis.__yinampSourceLabActions?.[${index}];if(!source?.button||!source.hasBrowseCommand)return false;source.button.click();return true;})()`, true);
  if (!clicked) throw new Error('This shelf has no actionable More button.');
  // Allow the site's own authenticated service request and response to settle.
  for (let attempts = 0; attempts < 20; attempts++) {
    await sleep(250);
    const requests = report.requests.filter(value => value.stage === stage && value.endpoint.endsWith('/browse'));
    if (requests.length && requests.every(value => value.durationMs != null)) break;
  }
  await ready();
  await sleep(1200);
  for(let step=0;step<3;step++){await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`);await sleep(600);}
  const page = await snapshot(); report.experiments.push({ title: previous?.title, durationMs: Date.now() - started, requests: report.requests.filter(value => value.stage === stage).length });
  publish(); await save(); return page;
}

async function run() {
  if (process.argv.includes('--mix-metadata')) {
    stage = 'mix-metadata'; pageStarted = Date.now();
    const url = new URL('https://music.youtube.com/browse/FEmusic_mixed_for_you');
    url.searchParams.set('params', 'ggMEgAKCBA%3D%3D');
    await music.loadURL(url.href); await ready(); await sleep(2000);
    for (let step = 0; step < 3; step++) {
      await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`); await sleep(600);
    }
    const dom = await music.webContents.executeJavaScript(`(${readDOM.toString()})()`);
    const items = parseMusicLibrary(dom.roots, 'mixes').items;
    report.mixMetadata = items.map(({id,title,subtitle,kind})=>({id,title,subtitle,kind}));
    await snapshot();
    await navigate('home');
    for (let step = 0; step < 6; step++) {
      await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`); await sleep(700);
    }
    const home = await music.webContents.executeJavaScript(`(${readDOM.toString()})()`);
    report.homeMixMetadata = parseMusicLibrary(home.roots, 'mine').items.filter(item=>item.kind==='mix').map(({id,title,subtitle,kind})=>({id,title,subtitle,kind}));
    await snapshot(); await save();
    console.log(JSON.stringify({kind:'mix-metadata',count:items.length,cards:report.mixMetadata})); return;
  }
  if (process.argv.includes('--owners')) {
    const pages = [];
    for (const route of ['home', 'library']) {
      await navigate(route);
      for (let step = 0; step < (route === 'home' ? 6 : 1); step++) {
        await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`);await sleep(700);
      }
      const roots = await music.webContents.executeJavaScript(`(${readDOM.toString()})().roots`);
      pages.push({route,cards:analyzeOwners(roots)});
    }
    const identityScript = `(()=>{
      const publicID=value=>typeof value==='string'&&/^UC[\\w-]{22}$/.test(value)?value:null;
      const configIDs=['CHANNEL_ID','USER_CHANNEL_ID'].map(key=>({key,id:publicID(globalThis.ytcfg?.get?.(key))})).filter(x=>x.id);
      const visibleLinks=[...document.querySelectorAll('a[href]')].filter(n=>n.getClientRects().length).map(n=>{try{const path=new URL(n.href,location.origin).pathname;return /^\\/channel\\/UC[\\w-]{22}$/.test(path)?path:null;}catch{return null;}}).filter(Boolean);
      const menus=[...document.querySelectorAll('ytmusic-multi-page-menu-renderer,yt-multi-page-menu-renderer,ytmusic-menu-popup-renderer,yt-active-account-header-renderer')].filter(n=>n.getClientRects().length).map(n=>({tag:n.localName,keys:Object.keys(n.data??n.__data?.data??{})}));
      return {configIDs,visibleLinks,menus};
    })()`;
    const before = await music.webContents.executeJavaScript(identityScript);
    const clicked = await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-nav-bar #avatar-btn,ytmusic-nav-bar #avatar');if(n){n.click();return true;}return false;})()`,true);
    await sleep(800);
    const after = await music.webContents.executeJavaScript(identityScript);
    const navShape = await music.webContents.executeJavaScript(`(()=>[...document.querySelectorAll('ytmusic-nav-bar button,ytmusic-nav-bar ytmusic-settings-button,ytmusic-nav-bar tp-yt-paper-icon-button')].filter(n=>n.getClientRects().length).map(n=>({tag:n.localName,id:n.id,hasImage:Boolean(n.querySelector('img')),dataKeys:Object.keys(n.data??n.__data?.data??{})})))()`);
    stage = 'public-channel-identity';
    await music.loadURL('https://www.youtube.com/account_advanced');await sleep(1500);
    const advanced = music.webContents.getURL().startsWith('https://www.youtube.com/account_advanced') ? await music.webContents.executeJavaScript(`(()=>{const valid=x=>typeof x==='string'&&/^UC[\\w-]{22}$/.test(x.trim());return {channelIDs:[...new Set([...document.querySelectorAll('input,textarea')].map(n=>n.value).filter(valid).map(x=>x.trim()))],channelLinks:[...new Set([...document.querySelectorAll('a[href]')].filter(n=>n.getClientRects().length).map(n=>{try{const p=new URL(n.href,location.origin).pathname;return /^\\/channel\\/UC[\\w-]{22}$/.test(p)?p:null;}catch{return null;}}).filter(Boolean))]};})()`) : {unavailable:true};
    report.ownerProbe = {pages,before,after,avatarOpened:clicked,navShape,advanced};
    await save();console.log(JSON.stringify({kind:'owner-probe',counts:pages.map(p=>({route:p.route,cards:p.cards.length,withByline:p.cards.filter(c=>c.byline.length).length})),before,after,navShape,advanced}));return;
  }
  let home = await navigate('home');
  console.log(JSON.stringify({ stage: 'home', signedIn: home.signedIn, rawCards: home.catalog?.count, withArtwork: home.catalog?.withArtwork, productionMixes: home.productionParser?.mixes, shelves: home.catalog?.shelves.map(shelf => ({ title: shelf.title, cards: shelf.cards, browseId: shelf.browseId, endpointKeys: shelf.endpointKeys })), actions: home.actions?.map(action => ({ title: action.title, hasButton: action.hasButton })) }));
  if (!home.signedIn) { report.sessionUnavailable = true; await save(); return; }
  for (let step = 0; step < 5; step++) {
    stage = 'home-scroll'; pageStarted = Date.now();
    await music.webContents.executeJavaScript(`(()=>{window.scrollTo(0,document.documentElement.scrollHeight);for(const node of document.querySelectorAll('ytmusic-app,ytmusic-app *'))if(node.scrollHeight>node.clientHeight+100&&/auto|scroll/.test(getComputedStyle(node).overflowY))node.scrollTop=node.scrollHeight;})()`);
    await sleep(1000); home = await snapshot();
  }
  console.log(JSON.stringify({ stage: 'expanded-home', rawCards: home.catalog.count, withArtwork: home.catalog.withArtwork, thumbnailHosts: home.catalog.thumbnailHosts,
    sources: home.catalog.shelves.map(source => ({ title: source.title, shelfId: source.shelfId, browseId: source.browseId, cards: source.cards, endpointKeys: source.endpointKeys, headerKeys: source.headerKeys })),
    commands: report.requests.map(value => ({ endpoint: value.endpoint, browseId: value.browseId, hasContinuation: value.hasContinuation, status: value.status, durationMs: value.durationMs })) }));
  const targets = home.actions.filter(action => action.hasButton && action.hasBrowseCommand && ['FEmusic_mixed_for_you', 'FEmusic_moods_and_genres', 'FEmusic_moods_and_genres_category'].includes(action.browseId)).slice(0, 4);
  for (const target of targets) {
    await navigate('home');
    for (let step = 0; step < 5; step++) {
      await music.webContents.executeJavaScript(`(()=>{window.scrollTo(0,document.documentElement.scrollHeight);for(const node of document.querySelectorAll('ytmusic-app,ytmusic-app *'))if(node.scrollHeight>node.clientHeight+100&&/auto|scroll/.test(getComputedStyle(node).overflowY))node.scrollTop=node.scrollHeight;})()`);
      await sleep(700);
    }
    await snapshot();
    const current = report.pages.at(-1).actions.find(action => action.browseId === target.browseId && action.params === target.params);
    try {
      const page = await openSource(current.index);
      if (current.browseId === 'FEmusic_moods_and_genres') {
        const chosen = await music.webContents.executeJavaScript(`(()=>{const n=[...document.querySelectorAll('ytmusic-navigation-button-renderer')].find(n=>n.getClientRects().length&&(n.data??n.__data?.data)?.clickCommand?.browseEndpoint);if(!n)return null;const e=(n.data??n.__data?.data).clickCommand.browseEndpoint;n.click();return {browseId:e.browseId,params:e.params};})()`,true);
        if(chosen){stage='directory-category';pageStarted=Date.now();await sleep(2000);await snapshot();report.experiments.push({kind:'directory-category',...chosen});}
      }
      console.log(JSON.stringify({ stage: target.title, rawCards: page.catalog?.count, withArtwork: page.catalog?.withArtwork, elapsedMs: page.elapsedMs, requests: report.requests.filter(value => value.stage.startsWith('source:')).map(value => ({ endpoint: value.endpoint, browseId: value.browseId, status: value.status, durationMs: value.durationMs, cards: value.catalog?.count })) }));
    } catch (error) { report.experiments.push({ title: target.title, error: error.message }); }
  }
  const mixRequest = report.requests.find(r => r.browseId === 'FEmusic_mixed_for_you');
  if (mixRequest) {
    const began = Date.now();
    try {
      stage = 'cookie-only-minimal-client';
      const response = await music.webContents.session.fetch('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: { client: { clientName: mixRequest.client, clientVersion: mixRequest.version, hl: mixRequest.locale } }, browseId: mixRequest.browseId, params: mixRequest.params }) });
      const data = await response.json();
      report.experiments.push({ kind: 'cookie-only-minimal-client', status: response.status, durationMs: Date.now() - began, catalog: analyzeMusicData(data) });
    } catch (error) { report.experiments.push({ kind: 'cookie-only-minimal-client', failed: true, durationMs: Date.now() - began }); }
  }
  const library = await navigate('library');
  console.log(JSON.stringify({ stage: 'library', signedIn: library.signedIn, rawCards: library.catalog?.count, withArtwork: library.catalog?.withArtwork, thumbnailPaths: library.catalog?.thumbnailPaths }));
  for (let step = 0; step < 4; step++) {
    stage = 'library-scroll'; pageStarted = Date.now();
    await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`); await sleep(800); await snapshot();
  }
  if (process.argv.includes('--queries')) {
    await navigate('search', 'indie roadtrip'); await sleep(1200); await snapshot();
    const categories = await music.webContents.executeJavaScript(`(()=>{const active=document.querySelector('ytmusic-search-page:not([hidden])')??document.querySelector('ytmusic-app #content');const nodes=[...active.querySelectorAll('ytmusic-chip-cloud-chip-renderer')].filter(n=>n.getClientRects().length);globalThis.__yinampQueryChips=nodes;return nodes.map((n,index)=>{const d=n.data??n.__data?.data??{};const e=d.navigationEndpoint??d.endpoint??{};return {index,params:e.searchEndpoint?.params,hasSearch:Boolean(e.searchEndpoint)};});})()`);
    report.experiments.push({kind:'search-categories',categories});
    for (const c of categories.filter(c=>c.hasSearch).slice(0,8)) {
      stage='search-category:'+c.index; pageStarted=Date.now();
      await music.webContents.executeJavaScript(`(()=>{const active=document.querySelector('ytmusic-search-page:not([hidden])')??document.querySelector('ytmusic-app #content');const n=[...active.querySelectorAll('ytmusic-chip-cloud-chip-renderer')].find(n=>{const d=n.data??n.__data?.data??{};return n.getClientRects().length&&(d.navigationEndpoint??d.endpoint)?.searchEndpoint?.params===${JSON.stringify(c.params)};});if(n){n.click();return true;}return false;})()`,true); await sleep(1500); await snapshot();
      await music.webContents.executeJavaScript(`(()=>{const n=document.querySelector('ytmusic-app #content');if(n)n.scrollTop=n.scrollHeight;})()`);await sleep(800);await snapshot();
    }
  }
  await save();
}

async function start() {
await app.whenReady();
console.log('Source lab: Electron ready.');
if (process.argv.includes('--validate-production')) {
  app.on('window-all-closed', () => {});
  const { createMusicLibrary } = await import('../../electron/library.mjs');
  const library = createMusicLibrary();
  const validation = { startedAt: new Date().toISOString(), sections: [] };
  try {
    for (const section of ['mine', 'mixes', 'discover']) {
      const began = Date.now(); const value = await library.browse(section);
      const cachedAt = Date.now(); const cached = await library.browse(section);
      validation.sections.push({ section, durationMs: cachedAt - began, count: value.items.length,
        unique: new Set(value.items.map(i => i.id)).size, withArtwork: value.items.filter(i => i.thumbnail).length,
        mixArtwork: value.items.filter(i => { try { return new URL(i.thumbnail).pathname === '/image/mixart'; } catch { return false; } }).length,
        partial: value.partial, excludedOwn: value.excludedOwn, ownerFilterUnavailable: value.ownerFilterUnavailable, withOwner: value.items.filter(i=>i.ownerId).length, cacheMs: Date.now() - cachedAt, cacheSame: cached === value,
        kinds: [...new Set(value.items.map(i => i.kind))] });
      if (section === 'mixes') {
        const preview = new BrowserWindow({ show: false, width: 1100, height: 850,
          webPreferences: { partition: 'persist:yinamp-interface', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        try {
          await preview.loadURL('data:text/html,<html><body></body></html>');
          await preview.webContents.executeJavaScript(`(()=>{for(const src of ${JSON.stringify(value.items.map(i=>i.thumbnail))}){const image=document.createElement('img');image.referrerPolicy='no-referrer';image.src=src;document.body.append(image);}})()`);
          const began = Date.now(); let artwork;
          while(Date.now()-began<10000) {
            artwork = await preview.webContents.executeJavaScript(`(()=>{const images=[...document.images];return {total:images.length,loaded:images.filter(i=>i.complete&&i.naturalWidth>0).length,failed:images.filter(i=>i.complete&&!i.naturalWidth).length};})()`);
            if(artwork.loaded+artwork.failed===artwork.total)break;
            await sleep(200);
          }
          validation.sections.at(-1).renderedArtwork = artwork;
        } finally { preview.destroy(); }
      }
      await mkdir(reports, { recursive: true });
      await writeFile(join(reports, 'production-validation.json'), JSON.stringify(validation, null, 2), { mode: 0o600 });
      console.log(JSON.stringify(validation.sections.at(-1)));
    }
    const began = Date.now(); const refreshed = await library.browse('mixes', true);
    validation.refresh = { durationMs: Date.now() - began, count: refreshed.items.length };
    library.invalidate();
    const invalidatedAt = Date.now(); const after = await library.browse('mine');
    validation.invalidated = { durationMs: Date.now() - invalidatedAt, count: after.items.length };
  } catch (error) { validation.error = error.message; }
  await mkdir(reports, { recursive: true });
  await writeFile(join(reports, 'production-validation.json'), JSON.stringify(validation, null, 2), { mode: 0o600 });
  app.quit(); return;
}

panel = new BrowserWindow({ title: 'Yinamp · Music source lab', width: 720, height: 900, show: !automatic,
  webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
music = new BrowserWindow({ title: 'Yinamp source lab — YouTube Music', width: 1100, height: 850, show: true,
  webPreferences: { partition: 'persist:yinamp-youtube', contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false } });
music.webContents.setAudioMuted(true);
music.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
const guard = (event, url, _inPlace, main) => { if (event.isMainFrame !== false && main !== false && !isAccountURL(url)) event.preventDefault(); };
music.webContents.on('will-navigate', guard); music.webContents.on('will-redirect', guard);
const observer = observe(music.webContents);
const initialNavigation = music.loadURL('https://music.youtube.com/?hl=en');
await Promise.race([observer, new Promise((_resolve, reject) => setTimeout(() => reject(new Error('Network observer did not initialize.')), 10000))]);
console.log('Source lab: network observer ready.');
await initialNavigation;
await panel.loadFile(join(directory, 'index.html'));
ipcMain.handle('source-lab:action', async (event, value) => {
  if (event.sender !== panel.webContents || event.senderFrame !== panel.webContents.mainFrame) throw new Error('Untrusted experiment action.');
  if (busy) throw new Error('The current experiment is still running.');
  busy = true;
  try {
    if (value.action === 'snapshot') await snapshot();
    else if (value.action === 'navigate') await navigate(value.route, value.query);
    else if (value.action === 'source') await openSource(value.index);
    else if (value.action === 'run') await run();
    else if (value.action === 'save') await save();
    else throw new Error('Unknown experiment action.');
    return report;
  } finally { busy = false; }
});
app.on('window-all-closed', () => app.quit());
const deadline = automatic ? setTimeout(() => { void save().finally(() => app.quit()); }, 150000) : null; deadline?.unref();
if (automatic) {
  try { await run(); } catch (error) { report.error = error.message; console.error('Source experiment failed:', error.message); process.exitCode = 1; }
  await save(); app.quit();
} else { await navigate('home'); }

}
void start().catch(async error => {
  report.error = error.code || error.name || "Prototype startup failed";
  console.error("Source lab startup failed:", report.error);
  await save(); app.quit();
});
