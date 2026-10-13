import test from 'node:test';
import assert from 'node:assert/strict';
import { readYouTubeAccount, accountSnapshot, accountState, navigationDetails, isAccountStatusPage, shouldCompleteChannelSwitch } from '../electron/account.mjs';
import { isAccountURL } from '../electron/contracts.mjs';

test('login permits Google session transfers but keeps general Google navigation restricted', () => {
  assert.equal(isAccountURL('https://www.google.com/accounts/SetSID?secret=private'), true);
  assert.equal(isAccountURL('https://accounts.youtube.com/accounts/SetSID'), true);
  for (const value of ['https://www.google.com/search?q=test', 'https://www.google.com/accounts.evil/', 'https://www.google.com.evil.test/accounts/SetSID', 'https://name:password@accounts.google.com/v3/signin']) assert.equal(isAccountURL(value), false);
  assert.equal(isAccountStatusPage('https://accounts.google.com/v3/signin/challenge/pwd'), false);
  assert.equal(isAccountStatusPage('https://accounts.youtube.com/accounts/SetSID'), false);
  assert.equal(isAccountStatusPage('https://www.youtube.com/watch?v=IHHq6lAgZzs'), true);
  assert.equal(isAccountStatusPage('https://www.youtube.com/channel_switcher'), true);
});
test('login diagnostics keep route categories and hostnames without query parameters or credentials', () => {
  const value = navigationDetails('https://accounts.google.com/v3/signin/challenge/pwd?email=private@example.test#secret');
  assert.deepEqual(value, { host: 'accounts.google.com', route: 'password' });
  assert.deepEqual(navigationDetails('https://www.google.com/accounts/SetSID?token=secret'), { host: 'www.google.com', route: 'session-transfer' });
});
test('YouTube identity uses explicit login state, avatar and Premium branding without inferring membership', t => {
  const previous = { document: globalThis.document, ytcfg: globalThis.ytcfg, ytInitialData: globalThis.ytInitialData };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  globalThis.document = { querySelector: () => null };
  globalThis.ytcfg = { get: () => true };
  globalThis.ytInitialData = { topbar: { desktopTopbarRenderer: { logo: { topbarLogoRenderer: { iconImage: { iconType: 'YOUTUBE_PREMIUM_LOGO' } } }, topbarButtons: [{ topbarMenuButtonRenderer: { avatar: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/avatar=s88-c' }] } } }] } } };
  const signedIn = readYouTubeAccount();
  assert.equal(signedIn.status, 'signed-in'); assert.equal(signedIn.premium, true); assert.ok(signedIn.avatar);
  globalThis.ytInitialData.topbar.desktopTopbarRenderer.logo.topbarLogoRenderer.iconImage.iconType = 'YOUTUBE_LOGO';
  assert.equal(readYouTubeAccount().premium, null, 'Missing Premium branding is unknown membership');
  globalThis.ytcfg.get = () => false;
  assert.deepEqual(readYouTubeAccount(), { status: 'signed-out', avatar: null, name: null, premium: null });
  delete globalThis.ytcfg; delete globalThis.ytInitialData;
  assert.equal(readYouTubeAccount().status, 'unknown', 'Missing data is not a sign-out');
});
test('identity sanitization permits public avatar images and removes unsupported or signed-out fields', () => {
  for (const avatar of ['javascript:alert(1)', 'file:///tmp/avatar', 'https://evil.test/avatar', 'https://user:password@yt3.googleusercontent.com/avatar']) assert.equal(accountSnapshot({ status: 'signed-in', avatar }).avatar, null);
  assert.equal(accountSnapshot({ status: 'signed-in', avatar: 'https://yt3.googleusercontent.com/avatar=s48' }).avatar, 'https://yt3.googleusercontent.com/avatar=s48');
  assert.deepEqual(accountSnapshot({ status: 'signed-out', name: 'Old account', avatar: 'https://yt3.googleusercontent.com/avatar', premium: true }), { status: 'signed-out', avatar: null, name: null, premium: null });
});
test('account UI distinguishes the login window from the player, including account switches and sign-outs', () => {
  const user = accountSnapshot({ status: 'signed-in', avatar: 'https://yt3.googleusercontent.com/user=s48', premium: true });
  const out = accountSnapshot({ status: 'signed-out' });
  let state = accountState(out, user);
  assert.equal(state.status, 'signed-in'); assert.equal(state.playerStatus, 'signed-out'); assert.equal(state.needsRefresh, true); assert.equal(state.premium, null);
  state = accountState(user, accountSnapshot({ ...user, avatar: 'https://yt3.googleusercontent.com/user=s88' }));
  assert.equal(state.needsRefresh, false); assert.equal(state.premium, true);
  const different = accountState(user, accountSnapshot({ ...user, avatar: 'https://yt3.googleusercontent.com/other=s88' }));
  assert.equal(different.needsRefresh, true); assert.equal(different.premium, null); assert.equal(different.connectionConfirmed, false);
  const namedChannel = accountState(user, accountSnapshot({ ...user, name: 'My music channel' }));
  assert.equal(namedChannel.name, 'My music channel');
  assert.equal(namedChannel.connectionConfirmed, true);
  const incompleteLibraryIdentity = accountState(user, accountSnapshot({ ...user, avatar: null }));
  assert.equal(incompleteLibraryIdentity.connectionConfirmed, true); assert.equal(incompleteLibraryIdentity.avatar, user.avatar);
  assert.equal(accountState(user, out).needsRefresh, true);
  assert.equal(accountState(accountSnapshot({ status: 'checking' }), user).needsRefresh, false);
});

test('channel changes use the visible avatar instead of stale bootstrap identity', t => {
  const previous = { document: globalThis.document, ytcfg: globalThis.ytcfg, ytInitialData: globalThis.ytInitialData };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  globalThis.ytcfg = { get: () => true };
  globalThis.ytInitialData = { topbar: { desktopTopbarRenderer: { topbarButtons: [{ topbarMenuButtonRenderer: { avatar: { thumbnails: [{ url: 'https://yt3.googleusercontent.com/old=s88' }] } } }] } } };
  globalThis.document = { querySelector: selector => selector.startsWith('#avatar-btn') ? { querySelector: () => ({ getAttribute: () => 'https://yt3.googleusercontent.com/new=s48' }) } : null };
  assert.equal(readYouTubeAccount().avatar, 'https://yt3.googleusercontent.com/new=s48');
});
test('chooser completes only after a confirmed selection, including reselecting the current channel', () => {
  const before = { status: 'signed-in', avatar: 'https://yt3.googleusercontent.com/old=s48' };
  const after = { status: 'signed-in', avatar: 'https://yt3.googleusercontent.com/new=s88' };
  assert.equal(shouldCompleteChannelSwitch(before, after, false, 'https://www.youtube.com/account'), false);
  assert.equal(shouldCompleteChannelSwitch(before, before, true, 'https://www.youtube.com/account'), false);
  assert.equal(shouldCompleteChannelSwitch(before, { ...before, avatar: before.avatar.replace('s48', 's88') }, true, 'https://www.youtube.com/account'), false);
  assert.equal(shouldCompleteChannelSwitch(before, after, true, 'https://www.youtube.com/'), true);
  assert.equal(shouldCompleteChannelSwitch(before, before, true, 'https://www.youtube.com/'), true);
  assert.equal(shouldCompleteChannelSwitch(before, { status: 'unknown' }, true, 'https://accounts.google.com/'), false);
});
