import test from 'node:test';
import assert from 'node:assert/strict';
import { currentMusicOwner, readPublicChannelId } from '../electron/music-owner.mjs';

test('channel identity accepts one visible public channel field only on the verified account page', () => {
  const id = 'UC'+'a'.repeat(22);
  const read = (origin,pathname,inputs) => {
    const run = new Function('location','document',`return (${readPublicChannelId.toString()})();`);
    return run({origin,pathname},{querySelectorAll:()=>inputs.map(([value,visible])=>({value,getClientRects:()=>visible?[{}]:[]}))});
  };
  assert.equal(read('https://www.youtube.com','/account_advanced',[[id,true],['private-unrelated-value',true]]),id);
  assert.equal(read('https://accounts.google.com','/account_advanced',[[id,true]]),null);
  assert.equal(read('https://www.youtube.com','/watch',[[id,true]]),null);
  assert.equal(read('https://www.youtube.com','/account_advanced',[[id,false]]),null);
  assert.equal(read('https://www.youtube.com','/account_advanced',[[id,true],['UC'+'b'.repeat(22),true]]),null);
});

test('owner lookup avoids auth pages and rejects changed accounts', async () => {
  let read=false;
  const redirected={loadURL:async()=>{},getURL:()=> 'https://accounts.google.com/',executeJavaScript:async()=>{read=true;}};
  assert.equal(await currentMusicOwner(redirected),null);assert.equal(read,false);
  await assert.rejects(currentMusicOwner(redirected,()=>false),/account changed/);
  const id='UC'+'a'.repeat(22);
  const valid={loadURL:async url=>assert.equal(url,'https://www.youtube.com/account_advanced'),getURL:()=> 'https://www.youtube.com/account_advanced',executeJavaScript:async()=>id};
  assert.equal(await currentMusicOwner(valid),id);
});
