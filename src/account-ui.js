export function renderAccount(data, root = document) {
  const $ = selector => root.querySelector(selector);
  const signedIn = data.status === 'signed-in';
  const signedOut = data.status === 'signed-out';
  const label = signedIn ? data.premium ? 'YouTube Premium' : 'Signed in' : signedOut ? 'Sign in' : 'Account';
  const connected = data.connectionConfirmed === true;
  const connection = data.needsRefresh ? 'Update player' : connected ? 'Player connected' : data.playerStatus === 'signed-in' ? 'Player signed in' : signedOut ? 'Desktop YouTube' : signedIn && data.playerLoaded === false ? 'Ready to play' : signedIn ? 'Checking player…' : data.status === 'checking' ? 'Checking login…' : 'Login not confirmed';
  $('#account-label').textContent = label;
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
  $('#account-player-status').textContent = data.needsRefresh ? 'Your account changed. Update the player session to use it; the current track will reload paused.'
    : signedIn && data.playerLoaded === false ? 'Your desktop account is signed in. Choose a playlist to begin.'
    : connected ? 'The player is signed in with this account.'
    : data.playerStatus === 'signed-in' ? 'The player is signed in; its account identity has not yet been matched to the account window.'
    : signedOut && data.playerStatus === 'signed-out' ? 'The player is signed out. Sign in to use your account in Yinamp.'
    : 'Choose a track and check login status to confirm the player session.';
  $('#account-refresh').hidden = !data.needsRefresh;
  $('#account-error').textContent = data.issue || '';
  $('#account-error').hidden = !data.issue;
}
