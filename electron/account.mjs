import { isYouTubeURL } from './contracts.mjs';

export function isAccountStatusPage(value) {
  try { const url = new URL(value); return isYouTubeURL(value) && ['/', '/watch', '/account', '/account_advanced', '/account_privacy'].includes(url.pathname); } catch { return false; }
}

// Read only visible YouTube identity/branding and its public signed-in flag.
// Never run this on Google sign-in pages, or read credentials, cookies or tokens.
export function readYouTubeAccount() {
  const config = globalThis.ytcfg;
  const data = globalThis.ytInitialData;
  const topbar = data?.topbar?.desktopTopbarRenderer;
  const loggedIn = typeof config?.get === 'function' ? config.get('LOGGED_IN') : config?.data_?.LOGGED_IN;
  const loggedOut = data?.responseContext?.webResponseContextData?.loggedOut;
  const avatarButton = document.querySelector('#avatar-btn');
  const avatarData = topbar?.topbarButtons?.find(button => button.topbarMenuButtonRenderer?.avatar)?.topbarMenuButtonRenderer.avatar;
  const status = typeof loggedIn === 'boolean' ? loggedIn ? 'signed-in' : 'signed-out'
    : typeof loggedOut === 'boolean' ? loggedOut ? 'signed-out' : 'signed-in'
    : avatarButton ? 'signed-in' : 'unknown';
  const logo = topbar?.logo?.topbarLogoRenderer ?? document.querySelector('ytd-topbar-logo-renderer')?.data;
  const branding = [logo?.iconImage?.iconType, logo?.icon?.iconType, document.querySelector('#logo')?.getAttribute('aria-label')].filter(value => typeof value === 'string').join(' ');
  const avatar = avatarData?.thumbnails?.at(-1)?.url || avatarButton?.querySelector('img')?.getAttribute('src') || null;
  const name = document.querySelector('ytd-active-account-header-renderer #account-name')?.textContent?.trim() || null;
  return { status, avatar: status === 'signed-in' ? avatar : null, name: status === 'signed-in' ? name : null, premium: status === 'signed-in' && /premium/i.test(branding) ? true : null };
}
export const accountStatusScript = `(${readYouTubeAccount.toString()})()`;

export function accountSnapshot(value) {
  const status = ['signed-in', 'signed-out', 'unknown', 'checking'].includes(value?.status) ? value.status : 'unknown';
  let avatar = null;
  try {
    const url = new URL(value?.avatar);
    if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname.endsWith('.googleusercontent.com') || url.hostname.endsWith('.ggpht.com')) && url.href.length <= 2048) avatar = url.href;
  } catch { /* A missing avatar uses the local account icon. */ }
  return { status, avatar: status === 'signed-in' ? avatar : null, name: status === 'signed-in' && typeof value?.name === 'string' ? value.name.slice(0, 100) : null, premium: status === 'signed-in' && value?.premium === true ? true : null };
}
export function accountState(player, account, issue = '') {
  const known = ['signed-in', 'signed-out'].includes(account.status);
  const identity = known ? account : player;
  const avatarKey = value => value?.split('=')[0]?.split('?')[0];
  const needsRefresh = known && player.status !== 'checking' && (player.status !== account.status || Boolean(player.avatar && account.avatar && avatarKey(player.avatar) !== avatarKey(account.avatar)));
  const connectionConfirmed = player.status === 'signed-in' && !needsRefresh && (identity === player || Boolean(player.avatar && identity.avatar && avatarKey(player.avatar) === avatarKey(identity.avatar)));
  return { ...identity, premium: connectionConfirmed ? player.premium : null, accountPremium: account.premium, playerStatus: player.status, connectionConfirmed, needsRefresh, issue };
}
export function navigationDetails(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    const route = path.includes('setsid') || path.includes('checkcookie') ? 'session-transfer' : path.includes('passkey') ? 'passkey' : /\/(pwd|password)(\/|$)/.test(path) ? 'password' : path.includes('challenge') ? 'challenge' : path.includes('signin') || path.includes('servicelogin') ? 'sign-in' : isYouTubeURL(value) ? 'youtube' : 'other';
    return { host: url.hostname, route };
  } catch { return { host: '', route: 'other' }; }
}
