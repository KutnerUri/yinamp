// Public channel ID only. Never read auth pages, account contexts or other input
// values into diagnostics. YouTube's visible advanced-settings field is the
// authority; a library byline or display name is not proof of the current owner.
export function readPublicChannelId() {
  if (location.origin !== 'https://www.youtube.com' || location.pathname !== '/account_advanced') return null;
  const ids = new Set([...document.querySelectorAll('input,textarea')]
    .filter(node => node.getClientRects().length)
    .map(node => node.value?.trim())
    .filter(value => typeof value === 'string' && /^UC[\w-]{22}$/.test(value)));
  return ids.size === 1 ? [...ids][0] : null;
}
export async function currentMusicOwner(contents, isCurrent = () => true) {
  const assertCurrent = () => { if (!isCurrent()) throw new Error('The account changed. Refresh the library.'); };
  assertCurrent();
  try {
    await contents.loadURL('https://www.youtube.com/account_advanced');
    for (let attempt = 0; attempt < 12; attempt++) {
      assertCurrent();
      if (!contents.getURL().startsWith('https://www.youtube.com/account_advanced')) return null;
      const id = await contents.executeJavaScript(`(${readPublicChannelId.toString()})()`);
      if (/^UC[\w-]{22}$/.test(id ?? '')) return id;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return null;
  } catch (error) { assertCurrent(); return null; }
}
