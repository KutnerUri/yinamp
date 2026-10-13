import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSearchSources } from '../electron/search-results.mjs';
const item={id:'PLtest',title:'Playlist',kind:'playlist',thumbnail:'https://i.ytimg.com/cover.jpg'};
const run=options=>collectSearchSources({categories:['community','featured'],isCurrent:()=>true,...options});
test('unavailable second source finishes successfully and preserves first results',async()=>{
 const updates=[];
 const result=await run({load:async category=>category==='community'?{items:[item],partial:true}:{items:[],partial:false,unavailable:true},onResults:data=>updates.push(data)});
 assert.equal(result.items.length,1);assert.deepEqual(result.unavailableCategories,['featured']);assert.deepEqual(result.failedCategories,[]);assert.equal(updates.at(-1).items[0].thumbnail,item.thumbnail);
});
test('empty sources are successful empty results',async()=>{
 const result=await run({load:async()=>({items:[],partial:false})});assert.deepEqual(result.items,[]);assert.equal(result.partial,false);
});
test('later source failure returns a final partial result instead of rejecting usable data',async()=>{
 const result=await run({load:async category=>{if(category==='featured')throw Error('failed');return {items:[item],partial:false};}});
 assert.equal(result.items.length,1);assert.equal(result.partial,true);assert.deepEqual(result.failedCategories,['featured']);
});
test('first source failure can still finish with the second source, while all failures reject',async()=>{
 const result=await run({load:async category=>{if(category==='community')throw Error('failed first');return {items:[item],partial:false};}});assert.equal(result.items.length,1);
 const failure=Error('underlying');await assert.rejects(run({load:async()=>{throw failure;}}),failure);
});
test('sources are sequential and account cancellation stops the next source',async()=>{
 let current=true;const calls=[];
 await assert.rejects(run({isCurrent:()=>current,load:async category=>{calls.push(category);current=false;return {items:[item]};}}),{code:'LIBRARY_CANCELLED'});assert.deepEqual(calls,['community']);
});
test('duplicates preserve richer metadata from either source',async()=>{
 const result=await run({load:async category=>({items:[category==='community'?{...item,artist:'Artist'}:{...item,thumbnail:'',album:'Album'}],partial:false})});assert.equal(result.items.length,1);assert.equal(result.items[0].thumbnail,item.thumbnail);assert.equal(result.items[0].album,'Album');
});
