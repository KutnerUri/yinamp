import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSearchWindow } from '../electron/search-window.mjs';
function harness(collect, timeout = 100) {
 const windows=[];
 const owner=createSearchWindow({timeout,collect,createWindow:()=>{
  const contents=new EventEmitter();let destroyed=false;contents.isDestroyed=()=>destroyed;
  const window={webContents:contents,isDestroyed:()=>destroyed,destroy:()=>{destroyed=true;contents.emit('destroyed');}};windows.push(window);return window;
 }});return {owner,windows};
}
const query={query:'artist',category:'songs',pages:1};
test('healthy searches reuse one window and dispose resets it',async()=>{
 const {owner,windows}=harness(async()=>({items:[]}));
 await owner.run(query,()=>true);await owner.run(query,()=>true);assert.equal(windows.length,1);
 owner.dispose();assert.equal(windows[0].isDestroyed(),true);
 await owner.run(query,()=>true);assert.equal(windows.length,2);owner.dispose();
});
test('silent stalled search restarts once, then reports failure',async()=>{
 const {owner,windows}=harness(()=>new Promise(()=>{}),10);
 await assert.rejects(owner.run(query,()=>true),/after restarting/);assert.equal(windows.length,2);assert.ok(windows.every(w=>w.isDestroyed()));
});
test('renderer failure discards the old window and successful retry is reusable',async()=>{
 let calls=0;
 const {owner,windows}=harness(contents=>{if(++calls===1){queueMicrotask(()=>contents.emit('render-process-gone'));return new Promise(()=>{});}return Promise.resolve({items:[{id:'fresh'}]});});
 assert.equal((await owner.run(query,()=>true)).items[0].id,'fresh');assert.equal(windows.length,2);assert.equal(windows[0].isDestroyed(),true);
 await owner.run(query,()=>true);assert.equal(windows.length,2);owner.dispose();
});
test('account invalidation cancels without retry or stale results',async()=>{
 let current=true;
 const {owner,windows}=harness(()=>new Promise(()=>{}));
 const pending=owner.run(query,()=>current);current=false;owner.dispose();
 await assert.rejects(pending,{code:'LIBRARY_CANCELLED'});assert.equal(windows.length,1);
});
test('a renderer that fails while idle is replaced before the next search',async()=>{
 const {owner,windows}=harness(async()=>({items:[]}));
 await owner.run(query,()=>true);windows[0].webContents.emit('render-process-gone');assert.equal(windows[0].isDestroyed(),true);
 await owner.run(query,()=>true);assert.equal(windows.length,2);owner.dispose();
});
