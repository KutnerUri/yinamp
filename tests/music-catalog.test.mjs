import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { collectMusicCatalog } from '../electron/music-catalog.mjs';

function contentsFor({ destination, responseDelay = 1600 } = {}) {
  const debuggerAPI = new EventEmitter(); let attached = false, url;
  const data = { contents: [{ musicTwoRowItemRenderer: {
    title: { simpleText: 'Collection mix' },
    navigationEndpoint: { browseEndpoint: { browseId: 'VLRDTMAK_live', browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_PLAYLIST' } } } },
  } }] };
  debuggerAPI.attach = () => { attached = true; };
  debuggerAPI.isAttached = () => attached;
  debuggerAPI.detach = () => { attached = false; };
  debuggerAPI.sendCommand = async command => command === 'Network.getResponseBody' ? { body: JSON.stringify(data), base64Encoded: false } : {};
  const contents = { debugger: debuggerAPI, isDestroyed: () => false, getURL: () => url,
    executeJavaScript: async () => ({ ready: true, signedIn: true, items: [], hasMore: false, height: 850 }),
    loadURL: async target => {
      const parsed = new URL(target);
      assert.equal(parsed.pathname, '/browse/FEmusic_mixed_for_you');
      assert.equal(parsed.searchParams.get('params'), 'ggMEgAKCBA%3D%3D');
      url = destination ?? target;
      if (!destination) {
        debuggerAPI.emit('message', {}, 'Network.requestWillBeSent', { requestId: 'browse', request: { url: 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false' } });
        contents.timer = setTimeout(() => {
          debuggerAPI.emit('message', {}, 'Network.responseReceived', { requestId: 'browse', response: { url: 'https://music.youtube.com/youtubei/v1/browse?prettyPrint=false', status: 200 } });
          debuggerAPI.emit('message', {}, 'Network.loadingFinished', { requestId: 'browse' });
        }, responseDelay);
      }
    },
  };
  return contents;
}

test('an empty rendered shell cannot finish before the actual browse response', async t => {
  const contents = contentsFor(); t.after(() => clearTimeout(contents.timer));
  const result = await collectMusicCatalog(contents, 'mixes');
  assert.deepEqual(result.items.map(i => i.id), ['RDTMAK_live']);
  assert.equal(result.partial, false);
  assert.equal(contents.debugger.isAttached(), false);
  assert.equal(contents.debugger.listenerCount('message'), 0);
});

test('auth redirects and changed accounts stop catalog collection and remove observation', async () => {
  const redirected = contentsFor({ destination: 'https://accounts.google.com/' });
  await assert.rejects(collectMusicCatalog(redirected, 'mixes'), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(redirected.debugger.isAttached(), false);
  const changed = contentsFor();
  await assert.rejects(collectMusicCatalog(changed, 'mixes', () => false), /account changed/);
  assert.equal(changed.debugger.listenerCount('message'), 0);
});
