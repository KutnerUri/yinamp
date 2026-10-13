import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicSongs, parsePlaylistTracks } from '../src/library-data.js';
import { searchMusic, suggestMusic } from '../music-query.mjs';
const row = (id, type) => ({ musicResponsiveListItemRenderer: {
 playlistItemData:{videoId:id}, flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Song title'}]}}}],
 overlay:{musicItemThumbnailOverlayRenderer:{content:{musicPlayButtonRenderer:{playNavigationEndpoint:{watchEndpoint:{videoId:id,watchEndpointMusicSupportedConfigs:{watchEndpointMusicConfig:{musicVideoType:type}}}}}}}}
} });
test('Songs search accepts typed audio overlays while excluding video and episode rows',()=>{
 const rows=parseMusicSongs({contents:[row('XzNWRmqibNE','MUSIC_VIDEO_TYPE_ATV'),row('M7lc1UVf-VE','MUSIC_VIDEO_TYPE_OMV'),row('IHHq6lAgZzs','MUSIC_VIDEO_TYPE_PODCAST_EPISODE')]});
 const tracks=parsePlaylistTracks({musicPlaylistShelfRenderer:{contents:rows.map(r=>({musicResponsiveListItemRenderer:r}))}}).tracks;
 assert.deepEqual(tracks.map(t=>t.id),['XzNWRmqibNE']);assert.equal(tracks[0].versions.song.id,'XzNWRmqibNE');
});
test('invalid searches are rejected before network access',async()=>{
 let calls=0;const fetcher=()=>{calls++;throw Error('Unexpected network');};
 for(const options of [{query:''},{query:'x',type:'episodes'},{query:'x',pages:11},{query:'x',pages:1.5}])await assert.rejects(searchMusic({...options,fetcher}),/Invalid search/);
 assert.equal(calls,0);
});
test('autocomplete is bounded public text and rejects short queries without requests',async()=>{
 let calls=0;const fetcher=async url=>{calls++;assert.equal(new URL(url).hostname,'suggestqueries.google.com');return {ok:true,json:async()=>['ab',['one','two',null,...Array(8).fill('three')]]};};
 assert.deepEqual(await suggestMusic('a',fetcher),[]);assert.equal(calls,0);assert.equal((await suggestMusic('ab',fetcher)).length,6);
});

test('desktop settings retain only pinned query definitions across normalization', async()=>{
 const {initialState}=await import('../src/core.js');
 const state=initialState({pinnedSearches:[{query:' Artist ',type:'songs',results:[{id:'secret'}],scroll:100,filter:'x'}, {query:'',type:'songs'}, {query:'x',type:'episodes'}]});
 assert.deepEqual(initialState(JSON.parse(JSON.stringify(state))).pinnedSearches,[{query:'Artist',type:'songs'}]);
});
