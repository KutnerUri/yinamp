import test from 'node:test';
import assert from 'node:assert/strict';
import { setupVisualizer } from '../src/visualizer.js';

test('spectrum rendering caps paint at 20 Hz and stops when hidden or settled', t => {
 const originals = Object.fromEntries(['document','matchMedia','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));
 t.after(()=>{for(const [key,value] of Object.entries(originals)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
 let paints=0, pending=new Map(), nextId=0;const listeners={};
 globalThis.document={hidden:false,createElement:()=>({style:{set transform(value){paints++;}}}),addEventListener:(key,fn)=>{listeners[key]=fn;},removeEventListener:key=>{delete listeners[key];}};
 globalThis.matchMedia=()=>({matches:false});
 globalThis.requestAnimationFrame=fn=>{pending.set(++nextId,fn);return nextId;};
 globalThis.cancelAnimationFrame=id=>pending.delete(id);
 const visualizer=setupVisualizer({append(){}});const start=performance.now();paints=0;
 const tick=time=>{const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn(time));};
 visualizer.update({active:true,bands:Array(20).fill(.7)});
 for(let index=1;index<=120;index++)tick(start+index*1000/120);
 assert.ok(paints/20<=21, `painted ${paints/20} times on a 120 Hz display`);
 assert.ok(paints/20>=19);
 document.hidden=true;listeners.visibilitychange();assert.equal(pending.size,0);
 document.hidden=false;listeners.visibilitychange();assert.equal(pending.size,1);
 visualizer.update();for(let index=1;index<=40;index++)tick(start+1000+index*50);
 assert.equal(pending.size,0);
 visualizer.destroy();assert.equal(Object.keys(listeners).length,0);
});
