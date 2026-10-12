import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLibrary, parsePlaylistTracks, musicLibraryURL, playlistURL } from '../src/library-data.js';
import { parseMusicLibraryHTML, parseMusicPlaylistHTML } from '../music-library.mjs';
import { createAppServer } from '../server.mjs';
import { once } from 'node:events';

const card = (id, title, type = 'MUSIC_PAGE_TYPE_PLAYLIST') => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: title }] }, subtitle: { runs: [{ text: 'Playlist · A listener' }] }, navigationEndpoint: { browseEndpoint: { browseId: `VL${id}`, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: type } } } }, thumbnailRenderer: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/IHHq6lAgZzs/hqdefault.jpg' }] } } } } });
const encodedPage = data => `const initialData=[];initialData.push({data:'${JSON.stringify(data).replace(/./g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, '0')}`)}'});`;
test('music catalog separates personal mixes from curated playlists and filters podcasts/albums', () => {
  const data = { contents: [card('PL_own', 'My music'), card('RDTMAK_test', 'My Supermix'), card('RDCLAK_test', 'Community rock'), card('PL_podcast', 'A show', 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE'), card('OLAK_album', 'An album', 'MUSIC_PAGE_TYPE_ALBUM'), { musicCarouselShelfRenderer: { header: { musicCarouselShelfBasicHeaderRenderer: { title: { runs: [{ text: 'Podcasts for you' }] } } }, contents: [card('PL_hidden', 'Generic show title')] } }, card('PL_own', 'Duplicate')] };
  assert.deepEqual(parseMusicLibrary(data).items.map(item => item.id), ['PL_own', 'RDTMAK_test', 'RDCLAK_test']);
  assert.deepEqual(parseMusicLibrary(data, 'mixes').items.map(item => item.id), ['RDTMAK_test']);
  assert.deepEqual(parseMusicLibrary(data, 'discover').items.map(item => item.id), ['PL_own', 'RDCLAK_test']);
  assert.throws(() => musicLibraryURL('password'));
  assert.equal(musicLibraryURL('mine'), 'https://music.youtube.com/library/playlists');
  assert.equal(playlistURL({id:'PL_own',source:'music'}),'https://music.youtube.com/playlist?list=PL_own');
  assert.throws(()=>playlistURL({id:'bad playlist'}));
});
test('playlist reading keeps source order, removes duplicates and excludes recommended songs', () => {
  const row = (id, title) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId: id }, flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } }], fixedColumns: [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: '3:13' }] } } }] } });
  const data = { contents: [{ musicPlaylistShelfRenderer: { contents: [row('IHHq6lAgZzs','August'),row('c8fu7tkc2Iw','Good Stuff'),row('IHHq6lAgZzs','Duplicate'),{continuationItemRenderer:{}}] } }, {musicShelfRenderer:{contents:[row('K4DyBUG242c','Recommendation')]}}] };
  const result = parsePlaylistTracks(data);
  assert.deepEqual(result.tracks.map(track=>track.id), ['IHHq6lAgZzs','c8fu7tkc2Iw']);assert.equal(result.tracks[0].duration,193);assert.equal(result.partial,true);
  assert.deepEqual(parseMusicPlaylistHTML(encodedPage(data)),result);
});
test('public HTML decoding never executes scripts or returns session data', () => {
  globalThis.__libraryExecuted = false;
  const html=encodedPage({contents:[card('PL_music','Safe music')],responseContext:{secret:'do-not-return'}})+';globalThis.__libraryExecuted=true;';
  const result=parseMusicLibraryHTML(html);
  assert.equal(globalThis.__libraryExecuted,false); assert.equal(result.items.length,1);assert.ok(!JSON.stringify(result).includes('do-not-return'));delete globalThis.__libraryExecuted;
  assert.throws(()=>parseMusicLibraryHTML('<html>No listing</html>'));
});
test('public discovery endpoint uses only YouTube Music and rejects personal library requests', async t => {
  const calls=[];
  const server=createAppServer({fetcher:async url=>{calls.push(String(url));return new Response(encodedPage({contents:[card('PL_discover','Community music')]}));}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/library?section=discover');assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,'PL_discover');
  assert.equal((await fetch(base+'/api/library?section=mine')).status,400);assert.deepEqual(calls,['https://music.youtube.com/']);
});
