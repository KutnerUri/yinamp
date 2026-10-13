export function renderAccount(data, root = document) {
  const $ = selector => root.querySelector(selector);
  const signedIn = data.status === 'signed-in';
  const signedOut = data.status === 'signed-out';
  const label = signedIn ? data.premium ? 'YouTube Premium' : 'Signed in' : signedOut ? 'Sign in' : 'Account';
  const connected = data.connectionConfirmed === true;
  const connection = data.needsRefresh ? 'Channel changed' : signedIn ? data.premium ? 'YouTube Premium' : 'YouTube' : signedOut ? 'Signed out' : 'Checking login…';
  $('#account-label').textContent = signedIn && data.name ? data.name : label;
  $('#account-connection').textContent = connection;
  $('#open-account').setAttribute('aria-label', `${label} — ${connection}. Account options`);
  $('#open-account').dataset.connected = String(connected);
  for (const [imageId, fallbackId] of [['account-avatar', 'account-avatar-fallback'], ['account-profile-avatar', 'account-profile-fallback']]) {
    const image = $(`#${imageId}`), fallback = $(`#${fallbackId}`);
    image.onerror = () => { image.hidden = true; fallback.hidden = false; };
    if (signedIn && data.avatar) {
      if (image.getAttribute('src') !== data.avatar) { image.src = data.avatar; image.hidden = false; fallback.hidden = true; }
    } else { image.removeAttribute('src'); image.hidden = true; fallback.hidden = false; }
  }
  $('#account-name').textContent = signedIn ? data.name || 'YouTube account' : 'Desktop YouTube account';
  $('#account-status').textContent = signedIn ? 'Signed in to YouTube' : signedOut ? 'Signed out of YouTube' : 'Login status not yet confirmed';
  $('#account-premium').hidden = !(signedIn && data.premium === true);
  $('#account-player-status').textContent = data.needsRefresh ? data.switching ? 'Switching channel…' : 'Your channel changed. Reload the player under Troubleshooting to finish updating.' : '';
  $('#account-player-status').hidden = !data.needsRefresh;
  $('#account-sign-in').hidden = signedIn;
  $('#account-sign-out').hidden = !signedIn;
  $('#account-refresh').hidden = !data.needsRefresh;
  $('#account-switch').hidden = signedOut;
  $('#account-error').textContent = data.issue || '';
  $('#account-error').hidden = !data.issue;
}
