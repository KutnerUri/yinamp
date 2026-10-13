// Avatar presentation can vary between Music and watch pages for one account.
export function libraryAccountIdentity(value) {
  let avatar = null;
  try {
    const url = new URL(value.avatar);
    const host = /^(yt[0-9]+)\.(ggpht\.com|googleusercontent\.com)$/.test(url.hostname) ? 'youtube-avatar' : url.hostname;
    avatar = host + url.pathname.split('=')[0];
  } catch { /* Identity may arrive before the avatar. */ }
  return { revision: value.revision ?? 0, status: value.status, avatar };
}

export function libraryAccountChanged(before, after) {
  return Boolean(before && (before.revision !== after.revision || before.status !== after.status ||
    (before.avatar && after.avatar && before.avatar !== after.avatar)));
}
