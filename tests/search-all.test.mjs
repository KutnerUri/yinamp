import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMixedMusicSearch,musicResultURL} from '../src/search-all-data.js';
import {checkSearchItems} from '../src/search-schema.js';
const browse=(id,type)=>({browseEndpoint:{browseId:id,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:type}}}});
const watch=(id,type)=>({watchEndpoint:{videoId:id,watchEndpointMusicSupportedConfigs:{watchEndpointMusicConfig:{musicVideoType:type}}}});
const row=(title,endpoint)=>({musicResponsiveListItemRenderer:{flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:title,navigationEndpoint:endpoint}]}}}],thumbnail:{musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'https://i.ytimg.com/cover.jpg'}]}}}}});
test('mixed search preserves top card and native mixed order while excluding episodes',()=>{
 const data={contents:[{musicCardShelfRenderer:{title:{runs:[{text:'Artist',navigationEndpoint:browse('UCabcdefghijkabcdefghijk','MUSIC_PAGE_TYPE_ARTIST')}]}}},row('Playlist',browse('VLPLtest','MUSIC_PAGE_TYPE_PLAYLIST')),row('Song',watch('XzNWRmqibNE','MUSIC_VIDEO_TYPE_ATV')),row('Video',watch('M7lc1UVf-VE','MUSIC_VIDEO_TYPE_OMV')),row('Episode',watch('IHHq6lAgZzs','MUSIC_VIDEO_TYPE_PODCAST_EPISODE'))]};
 const items=parseMixedMusicSearch(data);assert.deepEqual(items.map(i=>i.kind),['artist','playlist','song','video']);assert.equal(items[0].topResult,true);assert.equal(checkSearchItems(items,'all').issues.length,0);
});
test('album and song top cards have their proper type and ID',()=>{
 const album=parseMixedMusicSearch({musicCardShelfRenderer:{title:{runs:[{text:'Album',navigationEndpoint:browse('MPREb_test','MUSIC_PAGE_TYPE_ALBUM')}]}}});assert.equal(album[0].kind,'album');assert.equal(album[0].id,'MPREb_test');
 const song=parseMixedMusicSearch({musicCardShelfRenderer:{title:{runs:[{text:'Song',navigationEndpoint:watch('XzNWRmqibNE','MUSIC_VIDEO_TYPE_ATV')}]}}});assert.equal(song[0].kind,'song');
});
test('Music links cannot target arbitrary URLs or turn tracks into browse results',()=>{
 assert.equal(musicResultURL({kind:'album',id:'MPREb_test'}),'https://music.youtube.com/browse/MPREb_test');
 assert.throws(()=>musicResultURL({kind:'artist',id:'https://evil.example'}));assert.throws(()=>musicResultURL({kind:'song',id:'XzNWRmqibNE'}));
});
test('fresh-window network setup does not block the first navigation',async()=>{
 const {EventEmitter}=await import('node:events');const {collectUnfilteredSearch}=await import('../electron/search-all.mjs');
 const contents=new EventEmitter(),debuggerEvents=new EventEmitter();let url='about:blank',enabled,attached=false,navigations=0;
 debuggerEvents.attach=()=>{attached=true;};debuggerEvents.detach=()=>{attached=false;};debuggerEvents.isAttached=()=>attached;
 debuggerEvents.sendCommand=async method=>{if(method==='Network.enable')return new Promise(resolve=>{enabled=resolve;});};
 contents.debugger=debuggerEvents;contents.isDestroyed=()=>false;contents.getURL=()=>url;
 contents.loadURL=async value=>{url=value;navigations++;enabled();};
 contents.executeJavaScript=async()=>({ready:true,items:[{id:'XzNWRmqibNE',title:'Song',kind:'song'}],more:false});
 const updates=[];const result=await collectUnfilteredSearch(contents,'query','all',1,()=>true,()=>{},data=>updates.push(data));
 assert.equal(result.items[0].title,'Song');assert.equal(navigations,1);assert.equal(updates.length,1);assert.equal(attached,false);assert.equal(debuggerEvents.listenerCount('message'),0);
});
