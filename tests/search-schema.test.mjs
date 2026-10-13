import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSearchItems, checkSearchStructure, mergeSearchItem } from '../src/search-schema.js';
import { parseMusicLibrary } from '../src/library-data.js';
import { writeSearchMismatch } from '../electron/search-mismatch-log.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('schema drops malformed fields while retaining valid songs and omitting unknown data',()=>{
 const result=checkSearchItems([{id:'XzNWRmqibNE',title:'Song',kind:'song',artist:{private:'DO NOT LOG'},album:'Album',thumbnail:'https://evil.example/private',duration:-1,extra:'secret'}],'songs');
 assert.deepEqual(result.items,[{id:'XzNWRmqibNE',title:'Song',kind:'song',album:'Album'}]);assert.equal(result.issues.length,3);assert.ok(!JSON.stringify(result.issues).includes('DO NOT LOG'));assert.ok(!JSON.stringify(result.issues).includes('evil.example'));
 assert.equal(checkSearchItems([{id:'bad',title:'Song',kind:'song'}],'songs').items.length,0);
});
test('missing optional metadata is valid, unknown populated structures are reported',()=>{
 assert.equal(checkSearchItems([{id:'XzNWRmqibNE',title:'Song',kind:'song'}],'songs').issues.length,0);
 assert.ok(checkSearchStructure({musicShelfRenderer:{contents:[{unexpectedRenderer:{title:'private'}}]}}).issues.length);
 assert.ok(checkSearchStructure({unexpectedEnvelope:{}}).issues.length);
});
test('responsive playlist rows retain nested thumbnails and incomplete copies cannot erase them',()=>{
 const data={musicShelfRenderer:{contents:[{musicResponsiveListItemRenderer:{navigationEndpoint:{browseEndpoint:{browseId:'PLtest',browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_PLAYLIST'}}}},flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Playlist'}]}}}],thumbnail:{musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'https://i.ytimg.com/cover.jpg'}]}}}}}]}};
 // Playlist browse IDs carry the VL prefix.
 data.musicShelfRenderer.contents[0].musicResponsiveListItemRenderer.navigationEndpoint.browseEndpoint.browseId='VLPLtest';
 const item=parseMusicLibrary(data).items[0];assert.equal(item.thumbnail,'https://i.ytimg.com/cover.jpg');
 assert.equal(mergeSearchItem(item,{...item,thumbnail:''}).thumbnail,item.thumbnail);
 assert.equal(checkSearchStructure(data).issues.length,0);
});
test('dedicated mismatch log includes shape details and excludes arbitrary payloads',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'yinamp-schema-'));
 try{const path=join(directory,'mismatches.jsonl');assert.equal(writeSearchMismatch(path,{category:'songs',source:'response',field:'thumbnail',expected:'HTTPS URL',actual:'object',query:'PRIVATE QUERY',body:{cookie:'PRIVATE COOKIE'}}),true);
 const record=JSON.parse((await readFile(path,'utf8')).trim());assert.equal(record.field,'thumbnail');assert.ok(!JSON.stringify(record).includes('PRIVATE'));}finally{await rm(directory,{recursive:true,force:true});}
});
