import { app, BrowserWindow, WebContentsView, ipcMain, shell, Menu } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { appendFileSync, statSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { SPECTRUM_INTERVAL_MS } from '../src/spectrum-config.js';
import { initialState } from '../src/core.js';
import { YOUTUBE_PARTITION, INTERFACE_PARTITION, accountURL, isAccountURL, watchURL, isYouTubeURL, isExternalURL, viewBounds, validateCommand } from './contracts.mjs';
import { snapshotScript, commandScript, playerLayoutCSS, didProviderAdvance } from './page-scripts.mjs';
import { installSpectrumScript, readSpectrumScript, spectrumVolumeCSS } from './audio-spectrum.mjs';
import { accountSnapshot, accountState, accountStatusScript, isAccountStatusPage, navigationDetails, shouldCompleteChannelSwitch } from './account.mjs';
import { writeSearchMismatch } from './search-mismatch-log.mjs';
import { createMusicLibrary } from './library.mjs';
import { settleLibraryRequest } from './library-errors.mjs';

app.setName('Yinamp');
const profile = process.argv.find(value => value.startsWith('--profile='));
if (profile) app.setPath('userData', resolve(profile.slice('--profile='.length)));
const directory = fileURLToPath(new URL('.', import.meta.url));
let server, win, view, origin;
let writeQueue = Promise.resolve();
let spectrumPoll, spectrumReading = false, spectrumActive = false;
let poll, polling = false, requestedId = null, initializedVideo = false, loading = false;
let wantsPlay = false, volume = 75, muted = false, lastError = '', loadVersion = 0;
let equalizer = { enabled: true, preamp: 0, bands: Array(9).fill(0) };
let commandQueue = Promise.resolve();
let pendingStop = false, accountPlaybackPaused = false;
let queueEnded = false;
let accountWindow = null;
let accountRequested = false;
let suppressAccountRefresh = false;
let lastSnapshot = { current: 0 };
let youtubeSession;
let shuttingDown = false;
let diagnosticPath;
let accountPoll, accountReading = false, accountVersion = 0, loginIssue = '';
let accountClosing = false, channelSwitch = null, accountRevision = 0, authoritativeAccount = false;
let playerAccount = accountSnapshot({ status: 'checking' });
let windowAccount = accountSnapshot(null), publishedAccount = '';
const library = createMusicLibrary({ onMismatch: issue => { const logged = writeSearchMismatch(join(app.getPath('userData'), 'yinamp-search-mismatches.jsonl'), issue); send({ type: 'search-mismatch', data: { logged } }); }, onIdentity: identity => { if (!accountRequested && !accountClosing && !authoritativeAccount && identity.status === 'signed-in') { windowAccount = identity; publishAccount(); } } });
function diagnostic(event, details = {}) {
  if (!diagnosticPath) return;
  try {
    try { if (statSync(diagnosticPath).size > 262144) renameSync(diagnosticPath, diagnosticPath + '.previous'); } catch { /* No previous log yet. */ }
    appendFileSync(diagnosticPath, JSON.stringify({ time: new Date().toISOString(), pid: process.pid, electron: process.versions.electron, event, ...details }) + '\n');
  } catch { /* Diagnostics must never interrupt playback or shutdown. */ }
}
const send = event => { if (win && !win.isDestroyed()) win.webContents.send('yinamp:player-state', event); };
function publishAccount() {
  const data = accountState(playerAccount, windowAccount, loginIssue);
  data.playerLoaded = Boolean(requestedId);
  data.revision = accountRevision;
  data.switching = accountClosing;
  if (!requestedId) data.needsRefresh = false;
  const key = JSON.stringify(data);
  if (key !== publishedAccount) { publishedAccount = key; send({ type: 'account-state', data }); }
  return data;
}
async function readAccountContents(contents) {
  if (!contents || contents.isDestroyed() || !isAccountStatusPage(contents.getURL())) return null;
  const url = contents.getURL();
  let timer;
  try {
    const value = await Promise.race([contents.executeJavaScript(accountStatusScript), new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); })]);
    if (!value || contents.isDestroyed() || contents.getURL() !== url) return null;
    return accountSnapshot(value);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
async function refreshAccountStatus() {
  if (shuttingDown || accountReading || suppressAccountRefresh || accountClosing) return publishAccount();
  accountReading = true;
  const version = accountVersion;
  const playerVersion = loadVersion;
  try {
    const [player, account] = await Promise.all([loading ? null : readAccountContents(view?.webContents), readAccountContents(accountRequested ? accountWindow?.webContents : null)]);
    if (version !== accountVersion || shuttingDown) return publishAccount();
    if (player && playerVersion === loadVersion) playerAccount = player;
    if (account) windowAccount = account;
    if (channelSwitch && shouldCompleteChannelSwitch(channelSwitch.before, account, channelSwitch.chooserSeen, accountWindow?.webContents.getURL())) {
      accountWindow.close();
    }
    return publishAccount();
  } finally { accountReading = false; }
}
function navigateAccount(window, url) {
  library.invalidate();
  loginIssue = ''; publishAccount();
  // Navigation failures are reported by did-fail-load. Redirects may cancel
  // loadURL's promise, so do not make opening the window depend on that promise.
  void window.loadURL(url).catch(() => {});
  window.show(); window.focus();
}
const allowedSender = event => win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.origin === origin;
function trusted(event) { if (!allowedSender(event)) throw new Error('Untrusted desktop request'); }
async function external(url) { if (isExternalURL(url)) await shell.openExternal(url); }

function configureContents(contents, local = false) {
  contents.setWindowOpenHandler(({ url }) => { void external(url); return { action: 'deny' }; });
  contents.on('will-navigate', (event, url) => {
    if (local ? !url.startsWith(origin + '/') : !isExternalURL(url)) event.preventDefault();
  });
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
async function execute(command) {
  if (shuttingDown || !view?.webContents || view.webContents.isDestroyed() || !isYouTubeURL(view.webContents.getURL())) return { waiting: true };
  return view.webContents.executeJavaScript(commandScript(command), ['play', 'switch'].includes(command.type));
}
function queueCommand(command) {
  commandQueue = commandQueue.catch(() => {}).then(() => execute(command));
  return commandQueue;
}
async function pollVideo() {
  if (shuttingDown || polling || loading || !requestedId || !view?.webContents || view.webContents.isDestroyed() || !isYouTubeURL(view.webContents.getURL())) return;
  polling = true;
  const version = loadVersion;
  try {
    let data = await view.webContents.executeJavaScript(snapshotScript);
    if (version === loadVersion && queueEnded) {
      if ([1, 3].includes(data.state)) await execute({ type: 'pause' });
      return;
    }
    if (version === loadVersion && didProviderAdvance(data, requestedId, initializedVideo, isYouTubeURL(view.webContents.getURL()))) {
      // The provider can advance before the next poll. Yinamp owns the queue.
      await execute({ type: 'pause' });
      if (version !== loadVersion) return;
      queueEnded = true; wantsPlay = false;
      lastSnapshot = { ...lastSnapshot, id: requestedId, state: 0 };
      send({ type: 'snapshot', data: lastSnapshot });
      return;
    }
    if (version !== loadVersion) return;
    if (data.id !== requestedId) return;
    if (data.error) {
      if (data.error !== lastError) { lastError = data.error; send({ type: 'error', message: data.error, code: 100 }); }
      return;
    }
    if (!data.hasVideo) return;
    if (!initializedVideo && data.ready) {
      initializedVideo = true;
      try { await view.webContents.executeJavaScript(installSpectrumScript({ volume, muted, equalizer }), true); } catch { /* Keep ordinary playback if Web Audio is unavailable. */ }
      await view.webContents.insertCSS(playerLayoutCSS + (await view.webContents.executeJavaScript('Boolean(window.__yinampAudio)') ? spectrumVolumeCSS : ''));
      await execute({ type: 'volume', value: volume, muted });
      const result = await execute({ type: pendingStop ? 'stop' : wantsPlay ? 'play' : 'pause' });
      pendingStop = false;
      if (result?.blocked) send({ type: 'autoplay-blocked' });
      if (version !== loadVersion) return;
      data = await view.webContents.executeJavaScript(snapshotScript);
    }
    if (initializedVideo) {
      if (accountPlaybackPaused && !wantsPlay && [1, 3].includes(data.state)) {
        await execute({ type: 'pause' });
        if (version !== loadVersion) return;
        data = await view.webContents.executeJavaScript(snapshotScript);
      }
      if (Number.isFinite(data.volume)) volume = data.volume;
      muted = data.muted;
      lastSnapshot = data;
      send({ type: 'snapshot', data });
    }
  } catch { /* Page navigation may briefly destroy its JavaScript context. */ }
  finally { polling = false; }
}
async function pollSpectrum() {
  if (shuttingDown || spectrumReading || loading || queueEnded || !initializedVideo || !win || win.isDestroyed() || !win.isVisible() || win.isMinimized() || !view?.webContents || view.webContents.isDestroyed()) return;
  if (lastSnapshot.state === 2 || lastSnapshot.state === 0) return;
  spectrumReading = true;
  const version = loadVersion;
  try {
    const data = await view.webContents.executeJavaScript(readSpectrumScript);
    if (version === loadVersion && !loading && (data.active || spectrumActive !== data.active)) {
      spectrumActive = data.active;
      send({ type: 'spectrum', data });
    }
  } catch { /* Navigation destroys the old page graph; the new page installs its own. */ }
  finally { spectrumReading = false; }
}
async function loadVideo(command) {
  if (shuttingDown || !view?.webContents || view.webContents.isDestroyed()) return;
  if (!command.accountRefresh) accountPlaybackPaused = false;
  requestedId = command.id;
  queueEnded = false;
  spectrumActive = false;
  send({ type: 'spectrum', data: { active: false, bands: [] } });
  playerAccount = accountSnapshot({ status: command.id ? 'checking' : 'unknown' }); publishAccount();
  lastSnapshot = { current: command.start || 0 };
  initializedVideo = false; lastError = ''; wantsPlay = command.autoplay === true;
  pendingStop = false;
  const version = ++loadVersion;
  if (!command.id) { loading = false; await view.webContents.loadURL('about:blank'); return; }
  loading = true;
  send({ type: 'snapshot', data: { id: command.id, current: 0, duration: 0, volume, muted, state: 3 } });
  try {
    await view.webContents.loadURL(watchURL(command.id, command.start));
  } catch (error) {
    if (version === loadVersion && error.code !== 'ERR_ABORTED') send({ type: 'error', message: 'YouTube could not open this page. Check your connection and retry.' });
  } finally { if (version === loadVersion) { loading = false; void pollVideo(); } }
}

async function switchVideo(command) {
  if (loading) return { error: 'The player is still connecting. Click VID to retry.', unchanged: true };
  const version = ++loadVersion;
  loading = true;
  wantsPlay = command.autoplay;
  pendingStop = false;
  try {
    const result = await queueCommand(command);
    if (version !== loadVersion) return { superseded: true };
    if (!result?.switched) return { error: result?.error ?? 'This player could not switch recordings. Click VID to retry.', unchanged: true };
    requestedId = command.id;
    queueEnded = false;
    initializedVideo = false;
    lastError = '';
    lastSnapshot = { current: command.start };
    send({ type: 'snapshot', data: { id: command.id, current: command.start, duration: 0, volume, muted, state: 3 } });
    return { switched: true };
  } catch (error) {
    if (version !== loadVersion) return { superseded: true };
    return { error: error.message, unchanged: true };
  } finally {
    if (version === loadVersion) { loading = false; void pollVideo(); }
  }
}

function createPlayerView() {
  view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: YOUTUBE_PARTITION } });
  youtubeSession = view.webContents.session;
  view.setBackgroundColor('#080e08');
  win.contentView.addChildView(view);
  view.setVisible(false);
  configureContents(view.webContents);
  view.webContents.on('did-finish-load', () => void refreshAccountStatus());
  view.webContents.on('render-process-gone', (_event, details) => {
    if (shuttingDown || details.reason === 'clean-exit') return;
    ++loadVersion; loading = false; initializedVideo = false; wantsPlay = false;
    send({ type: 'error', message: 'The video player stopped unexpectedly. Press Retry to reload this track.' });
  });
  view.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
  });
}
async function refreshAccountPlayback() {
  if (shuttingDown || !win || win.isDestroyed() || !requestedId || !view?.webContents || view.webContents.isDestroyed()) return;
  // A fresh player view drops the previous renderer's channel state while
  // keeping the shared signed-in session, queue and playback position.
  const id = requestedId, start = lastSnapshot.current || 0;
  ++loadVersion; loading = true; initializedVideo = false; wantsPlay = false;
  const previous = view, bounds = previous.getBounds(), visible = previous.getVisible();
  win.contentView.removeChildView(previous);
  previous.webContents.close();
  createPlayerView();
  view.setBounds(bounds); view.setVisible(visible);
  accountPlaybackPaused = true;
  await loadVideo({ id, start, autoplay: false, accountRefresh: true });
}
async function openAccount(action) {
  const url = accountURL(action);
  channelSwitch = action === 'switch' ? { before: windowAccount.avatar ? windowAccount : playerAccount, chooserSeen: false } : null;
  accountRequested = true;
  if (accountWindow && !accountWindow.isDestroyed()) {
    if (action === 'switch' || !accountWindow.isVisible()) navigateAccount(accountWindow, url);
    else { accountWindow.show(); accountWindow.focus(); }
    return { opened: accountRequested };
  }
  accountWindow = new BrowserWindow({
    title: 'Yinamp — YouTube account', width: 760, height: 820, minWidth: 560, minHeight: 600, show: false,
    webPreferences: { partition: YOUTUBE_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  const window = accountWindow;
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isAccountURL(target)) navigateAccount(window, target);
    else { diagnostic('account-popup-blocked', navigationDetails(target)); loginIssue = 'A sign-in popup was blocked. Open the login log for details.'; publishAccount(); }
    return { action: 'deny' };
  });
  const guard = (event, target, _inPlace, isMainFrame) => {
    if (event.isMainFrame === false || isMainFrame === false) return;
    if (!isAccountURL(target)) {
      event.preventDefault(); diagnostic('account-navigation-blocked', navigationDetails(target));
      loginIssue = 'A sign-in redirect was blocked. Open the login log for details.'; publishAccount();
    }
  };
  window.webContents.on('will-navigate', guard);
  window.webContents.on('will-redirect', (event, target, inPlace, isMainFrame) => {
    if (event.isMainFrame !== false && isMainFrame !== false) diagnostic('account-navigation-redirect', navigationDetails(target));
    guard(event, target, inPlace, isMainFrame);
  });
  window.webContents.on('did-start-navigation', (_event, target, _inPlace, isMainFrame) => { if (isMainFrame && target !== 'about:blank') diagnostic('account-navigation-start', navigationDetails(target)); });
  window.webContents.on('did-navigate', (_event, target, code) => { if (target !== 'about:blank') {
    if (channelSwitch && ['/channel_switcher', '/account'].includes(new URL(target).pathname)) channelSwitch.chooserSeen = true; diagnostic('account-navigation-complete', { ...navigationDetails(target), code }); loginIssue = code >= 400 ? 'The account page returned an error. Close the account window and try again.' : ''; publishAccount(); } });
  window.webContents.on('did-navigate-in-page', (_event, target, isMainFrame) => { if (isMainFrame) { diagnostic('account-navigation-in-page', navigationDetails(target)); void refreshAccountStatus(); } });
  window.webContents.on('did-finish-load', () => void refreshAccountStatus());
  window.webContents.on('did-fail-load', (_event, code, _description, target, isMainFrame) => {
    if (!isMainFrame || code === -3 || !accountRequested) return;
    diagnostic('account-navigation-failed', { ...navigationDetails(target), code });
    loginIssue = 'The account page could not load. Close the account window and try again.'; publishAccount();
  });
  window.on('unresponsive', () => { diagnostic('account-unresponsive'); loginIssue = 'The account window is not responding. Close it and reopen Account.'; publishAccount(); });
  window.on('responsive', () => { diagnostic('account-responsive'); loginIssue = ''; publishAccount(); });
  const updateTitle = () => {
    try { window.setTitle(`Yinamp account — ${new URL(window.webContents.getURL()).hostname}`); } catch { /* The initial page is blank. */ }
  };
  window.webContents.on('did-navigate', updateTitle);
  window.webContents.on('page-title-updated', event => { event.preventDefault(); updateTitle(); });
  // No preload, IPC bridge or playback scripts. Identity is read only after
  // reaching a normal YouTube page, never on Google's authentication pages.
  window.once('ready-to-show', () => { if (accountRequested) window.show(); });
  // Reuse the account window rather than repeatedly destroying native windows.
  window.on('close', event => {
    if (shuttingDown) return;
    event.preventDefault();
    if (accountClosing) return;
    if (suppressAccountRefresh) { accountRequested = false; channelSwitch = null; window.hide(); return; }
    void finishAccountWindow(window);
  });
  window.on('closed', () => { accountWindow = null; });
  navigateAccount(window, url);
  return { opened: accountRequested };
}
async function finishAccountWindow(window) {
  accountClosing = true;
  ++accountVersion;
  library.invalidate();
  window.hide();
  try {
    // Capture the selected channel before discarding the chooser's page.
    const selected = await readAccountContents(window.webContents);
    if (selected && ['signed-in', 'signed-out'].includes(selected.status)) {
      windowAccount = selected;
      authoritativeAccount = true;
    }
    accountRequested = false;
    channelSwitch = null;
    playerAccount = accountSnapshot({ status: 'checking' });
    publishAccount();
    await window.loadURL('about:blank');
    await youtubeSession.cookies.flushStore();
    // Cached watch-page bootstrap data can still describe the previous channel.
    await youtubeSession.clearCache();
    await youtubeSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    await refreshAccountPlayback();
  } catch {
    loginIssue = 'The channel could not be refreshed. Try switching again.';
  } finally {
    accountRequested = false;
    channelSwitch = null;
    accountClosing = false;
    library.invalidate();
    ++accountRevision;
    await refreshAccountStatus();
    publishAccount();
  }
}
async function signOutAccount() {
  library.invalidate();
  suppressAccountRefresh = true;
  authoritativeAccount = false; channelSwitch = null;
  ++accountRevision;
  ++accountVersion;
  try {
    if (accountWindow && !accountWindow.isDestroyed()) {
      accountWindow.close();
      await accountWindow.loadURL('about:blank');
    }
    const id = requestedId; const start = lastSnapshot.current || 0;
    ++loadVersion; loading = false; initializedVideo = false; wantsPlay = false;
    view.webContents.stop();
    await view.webContents.loadURL('about:blank');
    // Clear only the YouTube session; the interface, saved playlists and browser profiles are separate.
    await youtubeSession.clearStorageData();
    await youtubeSession.clearCache();
    await youtubeSession.cookies.flushStore();
    playerAccount = accountSnapshot({ status: 'signed-out' }); windowAccount = accountSnapshot(null); loginIssue = ''; publishAccount();
    if (id) void loadVideo({ id, start, autoplay: false });
    return { signedOut: true };
  } finally { suppressAccountRefresh = false; }
}

async function start() {
  await mkdir(app.getPath('userData'), { recursive: true });
  diagnosticPath = join(app.getPath('userData'), 'yinamp-diagnostics.jsonl');
  diagnostic('startup');
  await writeFile(join(app.getPath('userData'), 'yinamp-search-mismatches.jsonl'), '', { flag: 'a' });
  app.on('render-process-gone', (_event, contents, details) => {
    const role = contents === win?.webContents ? 'interface' : contents === view?.webContents ? 'player' : contents === accountWindow?.webContents ? 'account' : 'other';
    diagnostic('renderer-gone', { role, reason: details.reason, exitCode: details.exitCode });
  });
  app.on('child-process-gone', (_event, details) => diagnostic('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode }));
  process.on('uncaughtExceptionMonitor', () => diagnostic('uncaught-exception'));
  const statePath = join(app.getPath('userData'), 'yinamp-state.json');
  server = createAppServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({
    title: 'Yinamp', width: 1120, height: 940, minWidth: 960, minHeight: 700, backgroundColor: '#14151e', show: false,
    webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: INTERFACE_PARTITION },
  });
  configureContents(win.webContents, true);
  createPlayerView();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Yinamp', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ label: 'Search mismatch log', click: () => shell.showItemInFolder(join(app.getPath('userData'), 'yinamp-search-mismatches.jsonl')) }, { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ]));
  ipcMain.handle('yinamp:read-state', async event => {
    trusted(event);
    try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; }
  });
  ipcMain.handle('yinamp:account', async (event, action) => {
    trusted(event);
    if (action === 'status') return refreshAccountStatus();
    if (action === 'refresh') { if (requestedId) void refreshAccountPlayback(); return { refreshed: Boolean(requestedId) }; }
    if (action === 'diagnostics') { shell.showItemInFolder(diagnosticPath); return { opened: true }; }
    if (action === 'sign-out') return signOutAccount();
    return openAccount(action);
  });
  ipcMain.handle('yinamp:library', async (event, value) => {
    trusted(event);
    return settleLibraryRequest(() => {
      if (value?.action === 'search') return library.search(value.query, value.type, value.pages ?? 1, value.refresh === true);
      if (value?.action === 'browse') return library.browse(value.section, value.refresh === true);
      if (value?.action === 'versions') return library.versions(value.id);
      if (value?.action === 'playlist') return library.playlist(value.playlist);
      throw new Error('Unsupported library request');
    });
  });
  ipcMain.handle('yinamp:save-state', (event, value) => {
    trusted(event);
    if (JSON.stringify(value).length > 1000000) throw new Error('Desktop state is too large');
    const data = JSON.stringify(initialState(value));
    writeQueue = writeQueue.catch(() => {}).then(async () => { await writeFile(statePath + '.tmp', data); await rename(statePath + '.tmp', statePath); });
    return writeQueue;
  });
  ipcMain.on('yinamp:layout', (event, bounds) => {
    if (!allowedSender(event)) return;
    try {
      const viewport = win.getContentBounds();
      const rectangle = viewBounds(bounds, viewport);
      view.setBounds(rectangle);
      view.setVisible(bounds.visible === true && rectangle.width >= 200 && rectangle.height >= 200);
    } catch { view.setVisible(false); }
  });
  ipcMain.handle('yinamp:player', async (event, value) => {
    trusted(event);
    const command = validateCommand(value);
    if (command.type === 'initialize') return { ready: true };
    if (command.type === 'load') { void loadVideo(command); return { loading: true }; }
    if (queueEnded && ['play', 'seek'].includes(command.type)) {
      void loadVideo({ id: requestedId, start: command.type === 'seek' ? command.value : 0, autoplay: command.type === 'play' });
      return { loading: true };
    }
    if (command.type === 'switch') return switchVideo(command);
    if (command.type === 'fullscreen') { win.setFullScreen(command.enabled === true); return { ok: true }; }
    if (command.type === 'equalizer') equalizer = structuredClone(command.settings);
    if (command.type === 'volume') { volume = command.value; muted = command.muted === true; }
    if (command.type === 'play') { wantsPlay = true; accountPlaybackPaused = false; }
    if (['pause', 'stop'].includes(command.type)) wantsPlay = false;
    if (command.type === 'stop') pendingStop = true;
    if (loading || !initializedVideo) return { queued: true };
    const result = await queueCommand(command);
    if (result?.blocked) send({ type: 'autoplay-blocked' });
    void pollVideo();
    return result;
  });
  spectrumPoll = setInterval(() => void pollSpectrum(), SPECTRUM_INTERVAL_MS);
  poll = setInterval(() => void pollVideo(), 300);
  accountPoll = setInterval(() => void refreshAccountStatus(), 4000);
  await win.loadURL(origin + '/');
  win.show();
  win.on('leave-full-screen', () => send({ type: 'fullscreen', enabled: false }));
  win.on('closed', () => { clearInterval(poll); clearInterval(spectrumPoll); clearInterval(accountPoll); if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close(); app.quit(); });
  app.on('before-quit', event => {
    if (shuttingDown) return;
    event.preventDefault(); shuttingDown = true;
    diagnostic('shutdown');
    library.invalidate();
    clearInterval(poll); clearInterval(spectrumPoll);
    clearInterval(accountPoll);
    writeQueue.catch(() => {}).finally(() => { server.close(); app.quit(); });
  });
}
app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
