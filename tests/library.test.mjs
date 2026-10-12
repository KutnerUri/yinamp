import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLibrary, parsePlaylistTracks, musicLibraryURL, playlistURL, withoutOwnedPlaylists } from '../src/library-data.js';
import { parseMusicLibraryHTML, parseMusicPlaylistHTML } from '../music-library.mjs';
import { createAppServer } from '../server.mjs';
import { once } from 'node:events';
import { PlaylistCache, PLAYLIST_CACHE_MS } from '../src/playlist-cache.js';
import { musicSearchBootstrap, musicSearchResult, musicPlaylist } from './fixtures/music.mjs';

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
test('validated preset URLs and provider mix/static artwork are preserved', () => {
  const url = new URL(musicLibraryURL('mixes'));
  assert.equal(url.pathname, '/browse/FEmusic_mixed_for_you');
  assert.equal(url.searchParams.get('params'), 'ggMEgAKCBA%3D%3D');
  assert.equal(musicLibraryURL('discover'), 'https://music.youtube.com/');
  const mix = card('RDTMAK_art', 'Mix cover');
  const image = 'https://music.youtube.com/image/mixart?encoded=opaque%2Bvalue&size=600';
  mix.musicTwoRowItemRenderer.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails = [{ url: image }];
  assert.equal(parseMusicLibrary(mix).items[0].thumbnail, image);
  const staticCard = card('LM', 'Liked music');
  staticCard.musicTwoRowItemRenderer.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails = [{ url: 'https://www.gstatic.com/youtube/media/ytm/images/pbg/liked-songs-delhi-576.png' }];
  assert.ok(parseMusicLibrary(staticCard).items[0].thumbnail);
  for (const bad of ['https://music.youtube.com/account', 'https://music.youtube.com.evil.example/image/mixart', 'http://music.youtube.com/image/mixart']) {
    mix.musicTwoRowItemRenderer.thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails = [{ url: bad }];
    assert.equal(parseMusicLibrary(mix).items[0].thumbnail, '');
  }
});
test('song and video cards carrying radio IDs never become mixes or consume real mix IDs', () => {
  const song = (id, title, videoId = 'IHHq6lAgZzs') => ({ musicTwoRowItemRenderer: {
    title: { runs: [{ text: title }] },
    navigationEndpoint: { watchEndpoint: { videoId, playlistId: id, watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: 'MUSIC_VIDEO_TYPE_ATV' } } } },
  } });
  const responsive = { musicResponsiveListItemRenderer: {
    playlistItemData: { videoId: 'c8fu7tkc2Iw' },
    flexColumns: [{ musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Good Stuff' }] } } }],
    navigationEndpoint: { watchEndpoint: { videoId: 'c8fu7tkc2Iw', playlistId: 'RDAMVMc8fu7tkc2Iw' } },
  } };
  const overlayOnly = { musicTwoRowItemRenderer: {
    title: { runs: [{ text: 'A video recommendation' }] },
    overlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'M7lc1UVf-VE', playlistId: 'RDVMM7lc1UVf-VE' } } } } } },
  } };
  const data = { contents: [song('RDAMVMIHHq6lAgZzs', 'August'), responsive, overlayOnly,
    song('RDTMAK_shared', 'A song from Supermix'), card('RDTMAK_shared', 'My Supermix'), card('RDCLAK_curated', 'Curated music')] };
  assert.deepEqual(parseMusicLibrary(data, 'mixes').items.map(item => item.title), ['My Supermix']);
  assert.deepEqual(parseMusicLibrary(data).items.map(item => item.title), ['My Supermix', 'Curated music']);
  assert.deepEqual(parseMusicLibrary(data, 'discover').items.map(item => item.title), ['Curated music']);
  // Desktop injects this self-contained parser into the YouTube view.
  const injected = (0, eval)(`(${parseMusicLibrary.toString()})`);
  assert.deepEqual(injected(data, 'mixes'), parseMusicLibrary(data, 'mixes'));
});
test('playlist navigation stays a mix even when its play overlay contains a seed song', () => {
  const mix = card('RDTMAK_seeded', 'Seeded Supermix');
  mix.musicTwoRowItemRenderer.thumbnailOverlay = { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchEndpoint: { videoId: 'IHHq6lAgZzs', playlistId: 'RDTMAK_seeded' } } } } } };
  const direct = { musicTwoRowItemRenderer: { title: { simpleText: 'Direct mix' }, navigationEndpoint: { watchPlaylistEndpoint: { playlistId: 'RDMM_direct' } } } };
  const watch = { musicTwoRowItemRenderer: { title: { simpleText: 'Mix without a seed' }, navigationEndpoint: { watchEndpoint: { playlistId: 'RDTMAK_unseeded' } } } };
  assert.deepEqual(parseMusicLibrary({ contents: [mix, direct, watch] }, 'mixes').items.map(item => item.id), ['RDTMAK_seeded', 'RDMM_direct', 'RDTMAK_unseeded']);
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
test('public discovery uses typed Music queries, caches the catalog and rejects personal requests', async t => {
  const calls=[];
  const server=createAppServer({fetcher:async (url, options)=>{calls.push({url:String(url),method:options?.method});return options?.method==='POST'?Response.json(musicSearchResult([musicPlaylist('PL_discover','Community music')])):new Response(musicSearchBootstrap());}});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const base=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(base+'/api/library?section=discover');assert.equal(response.status,200);assert.equal((await response.json()).items[0].id,'PL_discover');
  assert.equal(calls.length,4);assert.ok(calls.every(call=>new URL(call.url).hostname==='music.youtube.com'));
  await fetch(base+'/api/library?section=discover');
  assert.equal((await fetch(base+'/api/library?section=mine')).status,400);assert.equal(calls.length,4);
  await fetch(base+'/api/library?section=discover&refresh=1');assert.equal(calls.length,8);
});
test('playlist cache lasts 30 minutes, expires at the boundary, and clears account-scoped results', () => {
  let time=0;const cache=new PlaylistCache({now:()=>time,maxEntries:2});const data={tracks:[{id:'IHHq6lAgZzs'}]};
  assert.equal(PLAYLIST_CACHE_MS,1800000);cache.set('private-playlist',data);
  time=PLAYLIST_CACHE_MS-1;assert.equal(cache.get('private-playlist'),data);
  time=PLAYLIST_CACHE_MS;assert.equal(cache.get('private-playlist'),undefined);
  cache.set('mine',data);cache.set('home',data);cache.set('playlist',data);assert.equal(cache.get('mine'),undefined);
  cache.clear();assert.equal(cache.get('playlist'),undefined);assert.equal(cache.get('home'),undefined);
});

test('Discovery excludes only verified creator IDs, not names, artists, or saved membership', () => {
  const own = 'UC' + 'a'.repeat(22), other = 'UC' + 'b'.repeat(22);
  const owned = card('PL_owned', 'Created by me');
  const saved = card('PL_saved', 'Saved from another creator');
  const unknown = card('RDTMAK_personal', 'Personalized mix');
  const byline = id => ({text:'Same display name',navigationEndpoint:{browseEndpoint:{browseId:id,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_USER_CHANNEL'}}}}});
  owned.musicTwoRowItemRenderer.subtitle.runs = [byline(own)];
  saved.musicTwoRowItemRenderer.subtitle.runs = [byline(other)];
  const items = parseMusicLibrary({contents:[owned,saved,unknown]}).items;
  assert.equal(items[0].ownerId,own);
  assert.deepEqual(withoutOwnedPlaylists(items,own).map(i=>i.id),['PL_saved','RDTMAK_personal']);
  assert.equal(withoutOwnedPlaylists(items,null),items);
  assert.equal(withoutOwnedPlaylists(items,'Same display name'),items);
  const artist = card('RDTMAK_artist', 'Artist mix');
  artist.musicTwoRowItemRenderer.subtitle.runs = [byline(own)];
  artist.musicTwoRowItemRenderer.subtitle.runs[0].navigationEndpoint.browseEndpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig.pageType='MUSIC_PAGE_TYPE_ARTIST';
  assert.equal(parseMusicLibrary(artist).items[0].ownerId,null);
  const ambiguous = card('PL_ambiguous','Multiple credits');
  ambiguous.musicTwoRowItemRenderer.subtitle.runs = [byline(own),byline(other)];
  assert.equal(parseMusicLibrary(ambiguous).items[0].ownerId,null);
  const injected=(0,eval)(`(${parseMusicLibrary.toString()})`);
  assert.deepEqual(injected({contents:[owned,saved]}),parseMusicLibrary({contents:[owned,saved]}));
});
