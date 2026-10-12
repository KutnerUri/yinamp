import test from 'node:test';
import assert from 'node:assert/strict';
import { queryMusicPlaylists, musicSearchConfiguration, discoverMusicPlaylists, musicContinuations } from '../music-query.mjs';
import { musicSearchBootstrap, musicSearchResult, musicPlaylist } from './fixtures/music.mjs';

test('typed queries use the server category and follow continuations instead of mixed bootstrap rows', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url: String(url), options });
    if (!options?.method) { assert.equal(new URL(url).searchParams.get('hl'), 'en'); return new Response(musicSearchBootstrap()); }
    const body = JSON.parse(options.body);
    assert.equal(body.context.client.clientName, 'WEB_REMIX');
    assert.ok(!JSON.stringify(body).includes('private-session-value'));
    if (body.continuation) { assert.equal(body.continuation, 'page-two'); return Response.json(musicSearchResult([musicPlaylist('PL_first', 'Duplicate'), musicPlaylist('PL_second', 'Second')])); }
    assert.equal(body.query, 'indie roadtrip'); assert.equal(body.params, 'type-0');
    return Response.json(musicSearchResult([musicPlaylist('PL_first', 'First')], 'page-two'));
  };
  const result = await queryMusicPlaylists({ query: 'indie roadtrip', fetcher });
  assert.deepEqual(result.items.map(item => item.id), ['PL_first', 'PL_second']);
  assert.equal(result.partial, false); assert.equal(calls.length, 3);
  assert.ok(calls.every(call => new URL(call.url).origin === 'https://music.youtube.com'));
});

test('pagination limits and repeated continuations are reported without endless fetching', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    if (!options?.method) return new Response(musicSearchBootstrap());
    calls++; return Response.json(musicSearchResult([musicPlaylist(`PL_${calls}`, `Page ${calls}`)], 'repeat-token'));
  };
  const limited = await queryMusicPlaylists({ fetcher, maxPages: 1 });
  assert.equal(limited.partial, true); assert.equal(calls, 1);
  calls = 0;
  const repeated = await queryMusicPlaylists({ fetcher, maxPages: 10 });
  assert.equal(repeated.partial, true); assert.equal(calls, 2);
  assert.equal(repeated.items.length, 2);
});

test('discovery combines actual community and featured category requests, with community first', async () => {
  const filters = [];
  const fetcher = async (_url, options) => {
    if (!options?.method) return new Response(musicSearchBootstrap());
    const { params } = JSON.parse(options.body); filters.push(params);
    return Response.json(musicSearchResult(params === 'type-0' ? [musicPlaylist('PL_shared', 'Community')] : [musicPlaylist('PL_shared', 'Duplicate'), musicPlaylist('RDCLAK_featured', 'Featured')]));
  };
  const result = await discoverMusicPlaylists({ fetcher });
  assert.deepEqual(filters, ['type-0', 'type-1']);
  assert.deepEqual(result.items.map(item => item.id), ['PL_shared', 'RDCLAK_featured']);
  assert.deepEqual(result.items.map(item => item.community), [true, false]);
});

test('unsupported categories, missing configuration, and failed next pages are recoverable errors', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    calls++; if (!options?.method) return new Response(musicSearchBootstrap());
    return JSON.parse(options.body).continuation ? new Response('', { status: 503 }) : Response.json(musicSearchResult([musicPlaylist('PL_first', 'First')], 'more'));
  };
  await assert.rejects(queryMusicPlaylists({ fetcher, category: 'podcasts' }), /Unknown playlist category/);
  await assert.rejects(queryMusicPlaylists({ fetcher, query: '' }), /search/); assert.equal(calls, 0);
  assert.throws(() => musicSearchConfiguration('<script>arbitrary()</script>'), /listing|configuration/);
  await assert.rejects(queryMusicPlaylists({ fetcher }), /requested results/);
});

test('reload/sort commands do not become additional result pages', () => {
  assert.deepEqual(musicContinuations({ continuations: [{ reloadContinuationData: { continuation: 'sort-token' } }] }), []);
  assert.deepEqual(musicContinuations({ continuations: [{ nextContinuationData: { continuation: 'next-page' } }, { reloadContinuationData: { continuation: 'sort-token' } }], continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'next-page' } } } }), ['next-page']);
});
