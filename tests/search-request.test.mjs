import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { searchRequestFields, matchingSearchRequest } from '../electron/search-request.mjs';
const endpoint='https://music.youtube.com/youtubei/v1/search';
test('compressed search matching exposes only the consumed identity fields',()=>{
 const payload=JSON.stringify({query:'indie',params:'Eg%3D%3D',context:{credential:'PRIVATE'}});
 for(const [encoding,bytes] of [['gzip',gzipSync(payload)],['br',brotliCompressSync(payload)]]){
  const request={url:endpoint,headers:{'Content-Encoding':encoding},postDataEntries:[{bytes:bytes.toString('base64')}]};
  assert.deepEqual(searchRequestFields(request),{query:'indie',params:'Eg%3D%3D'});
  assert.equal(matchingSearchRequest(request,'indie','Eg==',new Set()),true);
  assert.equal(matchingSearchRequest(request,'other','Eg==',new Set()),false);
 }
});
test('only provider continuations returned for this category match',()=>{
 const request={url:endpoint+'?continuation=current-token',postData:'{"context":{}}'};
 assert.equal(matchingSearchRequest(request,'q','params',new Set(['current-token'])),true);
 assert.equal(matchingSearchRequest(request,'q','params',new Set(['other-token'])),false);
 assert.equal(matchingSearchRequest({...request,url:'https://other.example/youtubei/v1/search?continuation=current-token'},'q','params',new Set(['current-token'])),false);
});
test('malformed or oversized payloads cannot match a fresh query',()=>{
 assert.equal(searchRequestFields({postData:'not JSON'}),null);
 assert.equal(searchRequestFields({postData:'x'.repeat(1000001)}),null);
 assert.equal(matchingSearchRequest({url:endpoint,postData:'no'},'q','p',new Set()),false);
});
