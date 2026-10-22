import test from 'node:test';
import assert from 'node:assert/strict';
import { listBuilds } from '../electron/update-network.mjs';

test('release history paginates beyond the old limit and ignores drafts and rolling pointers', async () => {
  const releases = Array.from({ length: 125 }, (_, index) => ({ tag_name: `build-${index + 1}-1`, name: `1.2.${index} · Build ${index + 1}.1`, draft: false }));
  releases.splice(8, 0, { tag_name: 'latest-build' }, { tag_name: 'build-1000-1', draft: true });
  const requests = [];
  const builds = await listBuilds({ fetcher: async url => {
    const parsed = new URL(url); requests.push(parsed);
    const page = Number(parsed.searchParams.get('page'));
    return new Response(JSON.stringify(releases.slice((page - 1) * 100, page * 100)));
  } });
  assert.equal(requests.length, 2);
  assert.equal(builds.length, 125);
  assert.equal(builds.at(-1).version, '1.2.124');
});

test('a failed later page does not silently return truncated history', async () => {
  await assert.rejects(listBuilds({ fetcher: async url => new URL(url).searchParams.get('page') === '1'
    ? new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ tag_name: `build-${index}-1`, name: '1.2.0' }))))
    : new Response('rate limited', { status: 403 }) }), /403/);
});
