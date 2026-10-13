import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryAccountIdentity as identity, libraryAccountChanged as changed } from '../src/library-account.js';
const account = (avatar, revision = 0, status = 'signed-in') => identity({ avatar, revision, status });
test('library cache survives late avatars and equivalent watch/Music avatar URLs', () => {
  const music = account('https://yt3.ggpht.com/account=s88');
  const player = account('https://yt3.googleusercontent.com/account=s176');
  assert.equal(changed(music, player), false);
  assert.equal(changed(account(null), music), false);
  assert.equal(changed(music, account(null)), false);
});
test('library cache invalidates for confirmed channel, revision, and sign-in changes', () => {
  const before = account('https://yt3.ggpht.com/account=s88');
  assert.equal(changed(before, account('https://yt3.ggpht.com/another=s88')), true);
  assert.equal(changed(before, account(null, 1)), true);
  assert.equal(changed(before, account(null, 0, 'signed-out')), true);
});
