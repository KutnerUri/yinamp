import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackOwnership} from '../electron/playback-ownership.mjs';
import {controlPage} from '../electron/page-scripts.mjs';
const wrong={id:'other',isAd:false};
test('transient mismatches do not reload, persistent mismatch reloads only once',()=>{
 const guard=createPlaybackOwnership();assert.equal(guard.check(wrong,'selected',0),null);assert.equal(guard.check(wrong,'selected',1999),null);assert.equal(guard.check(wrong,'selected',2000),'reload');
 assert.equal(guard.check(wrong,'selected',3000),null);assert.equal(guard.check(wrong,'selected',5000),'error');
 guard.reset();assert.equal(guard.check(wrong,'selected',6000),null);assert.equal(guard.check(wrong,'selected',8000),'reload');
});
test('ads and correct IDs reset the mismatch grace period without restoring retry budget',()=>{
 const guard=createPlaybackOwnership();guard.check(wrong,'selected',0);assert.equal(guard.check({...wrong,isAd:true},'selected',3000),null);assert.equal(guard.check(wrong,'selected',4000),null);assert.equal(guard.check(wrong,'selected',6000),'reload');
 assert.equal(guard.check({id:'selected'},'selected',7000),null);guard.check(wrong,'selected',8000);assert.equal(guard.check(wrong,'selected',10000),'error');
});
test('autoplay changes only for the explicit settled-playback check',t=>{
 const previous=globalThis.document;let on=true,clicks=0;
 const toggle={getAttribute:()=>on?'true':'false',click:()=>{clicks++;on=false;}};
 globalThis.document={querySelector:selector=>selector==='.ytp-autonav-toggle-button'?toggle:null};t.after(()=>{globalThis.document=previous;});
 controlPage({type:'volume',value:20});controlPage({type:'pause'});assert.equal(clicks,0);
 controlPage({type:'autoplay-off'});controlPage({type:'autoplay-off'});assert.equal(clicks,1);assert.equal(on,false);
});
