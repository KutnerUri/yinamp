import { app, BrowserWindow, WebContentsView, ipcMain, shell, Menu } from 'electron';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { createAppServer } from '../server.mjs';
import { initialState } from '../src/core.js';
import { watchURL, isYouTubeURL, isExternalURL, viewBounds, validateCommand } from './contracts.mjs';
import { snapshotScript, commandScript, playerLayoutCSS } from './page-scripts.mjs';

app.setName('Yinamp');
const profile = process.argv.find(value => value.startsWith('--profile='));
if (profile) app.setPath('userData', resolve(profile.slice('--profile='.length)));
const directory = fileURLToPath(new URL('.', import.meta.url));
let server, win, view, origin;
let writeQueue = Promise.resolve();
let poll, polling = false, requestedId = null, initializedVideo = false, loading = false;
let wantsPlay = false, volume = 75, muted = false, lastError = '', loadVersion = 0;
let commandQueue = Promise.resolve();
let pendingStop = false;
const send = event => { if (win && !win.isDestroyed()) win.webContents.send('yinamp:player-state', event); };
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
  if (!view || view.webContents.isDestroyed() || !isYouTubeURL(view.webContents.getURL())) return { waiting: true };
  return view.webContents.executeJavaScript(commandScript(command), command.type === 'play');
}
function queueCommand(command) {
  commandQueue = commandQueue.catch(() => {}).then(() => execute(command));
  return commandQueue;
}
async function pollVideo() {
  if (polling || loading || !requestedId || !view || view.webContents.isDestroyed() || !isYouTubeURL(view.webContents.getURL())) return;
  polling = true;
  const version = loadVersion;
  try {
    let data = await view.webContents.executeJavaScript(snapshotScript);
    if (version !== loadVersion || data.id !== requestedId) return;
    if (data.error) {
      if (data.error !== lastError) { lastError = data.error; send({ type: 'error', message: data.error, code: 100 }); }
      return;
    }
    if (!data.hasVideo) return;
    if (!initializedVideo && data.ready) {
      initializedVideo = true;
      await view.webContents.insertCSS(playerLayoutCSS);
      await execute({ type: 'volume', value: volume, muted });
      const result = await execute({ type: pendingStop ? 'stop' : wantsPlay ? 'play' : 'pause' });
      pendingStop = false;
      if (result?.blocked) send({ type: 'autoplay-blocked' });
      if (version !== loadVersion) return;
      data = await view.webContents.executeJavaScript(snapshotScript);
    }
    if (initializedVideo) {
      if (Number.isFinite(data.volume)) volume = data.volume;
      muted = data.muted;
      send({ type: 'snapshot', data });
    }
  } catch { /* Page navigation may briefly destroy its JavaScript context. */ }
  finally { polling = false; }
}
async function loadVideo(command) {
  requestedId = command.id;
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

async function start() {
  await mkdir(app.getPath('userData'), { recursive: true });
  const statePath = join(app.getPath('userData'), 'yinamp-state.json');
  server = createAppServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({
    title: 'Yinamp', width: 1120, height: 940, minWidth: 960, minHeight: 700, backgroundColor: '#14151e', show: false,
    webPreferences: { preload: join(directory, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:yinamp-interface' },
  });
  view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:yinamp-youtube' } });
  view.setBackgroundColor('#080e08');
  win.contentView.addChildView(view);
  view.setVisible(false);
  configureContents(win.webContents, true);
  configureContents(view.webContents);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Yinamp', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
  ]));
  ipcMain.handle('yinamp:read-state', async event => {
    trusted(event);
    try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; }
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
    if (command.type === 'fullscreen') { win.setFullScreen(command.enabled === true); return { ok: true }; }
    if (command.type === 'volume') { volume = command.value; muted = command.muted === true; }
    if (command.type === 'play') wantsPlay = true;
    if (['pause', 'stop'].includes(command.type)) wantsPlay = false;
    if (command.type === 'stop') pendingStop = true;
    if (loading || !initializedVideo) return { queued: true };
    const result = await queueCommand(command);
    if (result?.blocked) send({ type: 'autoplay-blocked' });
    void pollVideo();
    return result;
  });
  poll = setInterval(() => void pollVideo(), 300);
  await win.loadURL(origin + '/');
  win.show();
  win.on('leave-full-screen', () => send({ type: 'fullscreen', enabled: false }));
  view.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && win.isFullScreen()) win.setFullScreen(false);
  });
  win.on('closed', () => { clearInterval(poll); if (!view.webContents.isDestroyed()) view.webContents.close(); app.quit(); });
  let shuttingDown = false;
  app.on('before-quit', event => {
    if (shuttingDown) return;
    event.preventDefault(); shuttingDown = true;
    clearInterval(poll);
    writeQueue.finally(() => { server.close(); app.quit(); });
  });
}
app.whenReady().then(start).catch(error => { console.error(error); app.quit(); });
