import test from 'node:test';
import assert from 'node:assert/strict';
import { navigateMusicSearch, matchesSearchPage } from '../electron/search-navigation.mjs';
function client(url='about:blank'){
 const state={url,loads:0,calls:0};
 const contents={isDestroyed:()=>false,getURL:()=>state.url,loadURL:async url=>{state.url=url;state.loads++;},executeJavaScript:async()=>{state.calls++;return true;}};
 return {state,contents};
}
test('startup loads once and repeated query does not load again',async()=>{
 const {state,contents}=client();assert.equal(await navigateMusicSearch(contents,'hello world',()=>true),'initial');
 assert.equal(await navigateMusicSearch(contents,'hello world',()=>true),'same-query');assert.equal(state.loads,1);
});
test('new query waits for matching controls and uses no full navigation',async()=>{
 const {state,contents}=client('https://music.youtube.com/search?q=old');let polls=0;
 contents.executeJavaScript=async()=>{if(!state.calls++){state.url='https://music.youtube.com/search?q=new';return true;}return ++polls>=2;};
 assert.equal(await navigateMusicSearch(contents,'new',()=>true,{wait:async()=>{}}),'internal');assert.equal(state.loads,0);assert.equal(polls,2);
});
test('missing controls fail without accepting stale content',async()=>{
 const {contents}=client('https://music.youtube.com/search?q=old');contents.executeJavaScript=async()=>false;
 await assert.rejects(navigateMusicSearch(contents,'new',()=>true),/controls changed/);
});
test('silent navigation stall is bounded and account change cancels waiting',async()=>{
 const {contents}=client('https://music.youtube.com/search?q=old');
 await assert.rejects(navigateMusicSearch(contents,'new',()=>true,{timeout:5,wait:async()=>{}}),/did not complete/);
 let current=true;
 await assert.rejects(navigateMusicSearch(contents,'new',()=>current,{wait:async()=>{current=false;}}),{code:'LIBRARY_CANCELLED'});
});
test('query identity rejects unrelated origins and other queries',async()=>{
 assert.equal(matchesSearchPage('https://music.youtube.com/search?q=a%26b','a&b'),true);
 assert.equal(matchesSearchPage('https://evil.example/search?q=a','a'),false);
 assert.equal(matchesSearchPage('https://music.youtube.com/search?q=previous','new'),false);
 const {contents}=client('https://accounts.google.com/');await assert.rejects(navigateMusicSearch(contents,'new',()=>true),/left its search page/);
});
