import { versionMenu } from './versions.mjs';
import { app, dialog, shell } from 'electron';
import { githubDownload, readManifest, listBuilds } from './update-network.mjs';
import { RELEASES, compatible, newer } from './update-store.mjs';

export function createUpdateController(store, { preview = false } = {}) {
  let restartRequested = false;
  let status = '', busy = false, builds = store.state.recentBuilds ?? [], needsDesktop = false, rebuild = () => {}, startupTimer, healthTimer, checkTimer, stopped = false, scheduleGeneration = 0;
  const label = metadata => metadata?.number ? `${metadata.version} · Build ${metadata.number}.${metadata.attempt}` : `${metadata?.version ?? app.getVersion()} · ${preview ? 'Development' : 'Local build'}`;
  const refresh = () => rebuild();
  const message = text => dialog.showMessageBox({ type: 'info', title: 'Yinamp versions', message: text });
  async function scheduleCheck() {
    const generation = ++scheduleGeneration;
    clearTimeout(checkTimer);
    if (preview || stopped || store.state.paused || store.state.pinned) return;
    try {
      const next = await store.scheduleCheck();
      if (generation !== scheduleGeneration || stopped || store.state.paused || store.state.pinned) return;
      checkTimer = setTimeout(() => void check(), Math.min(2147483647, Math.max(1000, next - Date.now())));
      checkTimer.unref();
    } catch { /* If timing cannot be saved, skip automatic requests for this session. */ }
  }
  async function refreshBuilds() {
    builds = await listBuilds();
    store.state.recentBuilds = builds;
    await store.save();
    refresh();
  }
  async function action(work) {
    if (busy) return;
    busy = true; refresh();
    try { await work(); }
    catch (error) { await message(error.message); }
    finally { busy = false; refresh(); }
  }
  async function download(manifest, { automatic = false, pin = false } = {}) {
    if (preview) return false;
    if (!compatible(manifest, store.electron, store.platform, store.runtimeManaged)) {
      needsDesktop = true;
      status = 'New desktop download required'; refresh();
      if (!automatic) await message('This build includes a newer desktop runtime. Choose “Download desktop app…” to install it. Your music and settings stay in place.');
      return false;
    }
    needsDesktop = false;
    status = 'Downloading update…'; refresh();
    const bytes = await githubDownload(manifest.payloads[store.platform].url);
    const staged = await store.stage(manifest, bytes, { automatic, pin });
    status = staged ? 'Update ready for next launch' : '';
    refresh(); return staged;
  }
  async function check(manual = false) {
    if (preview && !manual) return;
    if (busy || !manual && (store.state.paused || store.state.pinned)) { if (!manual) void scheduleCheck(); return; }
    busy = true;
    let receivedManifest = false;
    try {
      if (!await store.claimCheck({ manual })) return;
      status = 'Checking for updates…'; refresh();
      const manifest = await readManifest();
      receivedManifest = true;
      if (preview) {
        status = `Published build: ${label(manifest)}. Installation is disabled in development.`;
      } else if (store.state.paused || store.state.pinned) {
        status = newer(manifest, store.metadata()) ? 'A newer build is available. Enable automatic updates to download it, or choose a specific version.' : 'No newer build available. Automatic updates are disabled.';
      } else if (newer(manifest, store.metadata()) && !store.state.failed.includes(manifest.id)) {
        if (store.state.pending !== manifest.id) await download(manifest, { automatic: !manual });
        else status = 'Update ready for next launch';
      } else status = store.state.failed.includes(manifest.id) ? 'Keeping the previous working build' : 'Up to date';
      if (manual) await message(status);
    } catch (error) {
      status = 'Update check unavailable';
      if (manual) await message('Could not check for updates. Keep listening and try again later.');
    } finally { busy = false; refresh(); void scheduleCheck(); }
    if (receivedManifest) try { await refreshBuilds(); } catch { /* Retain cached history while offline. */ }
  }
  async function choose(id) {
    if (preview) return;
    if (await store.select(id)) { status = store.state.pending ? 'Version ready for next launch' : 'Automatic updates disabled'; return; }
    const manifest = await readManifest(id);
    if (manifest.id !== id) throw new Error('GitHub returned a different build');
    await download(manifest, { pin: true });
  }
  // The native supervisor owns runtime selection and relaunches the stable bootstrap.
  const relaunch = (bundled = false) => {
    if (store.runtimeManaged) {
      app.exit(bundled ? 77 : 76);
    } else if (bundled) app.relaunch({ args: [...process.argv.slice(1), '--yinamp-bundled'] });
    else app.relaunch();
  };
  const controller = {
    setMenuBuilder(callback) { rebuild = callback; },
    menu() {
      const current = store.metadata();
      const automatic = !store.state.paused && !store.state.pinned;
      const previous = store.metadata(store.state.previous);
      const versions = versionMenu([
        { ...current, label: label(current) },
        ...(previous ? [{ ...previous, label: label(previous) }] : []),
        ...builds,
      ], current.id, id => void action(() => choose(id)), !preview);
      return [
        { label: 'Check for updates…', enabled: !busy, click: () => void check(true) },
        { label: 'Restart to update', enabled: !preview && Boolean(store.state.pending) && !busy, click: () => {
          if (preview) return;
          if (store.runtimeManaged) restartRequested = true;
          else app.relaunch();
          app.quit();
        } },
        { label: automatic ? 'Automatic updates' : 'Automatic updates disabled', type: 'checkbox', checked: automatic, enabled: !preview && !busy, click: item => { if (!preview) void action(async () => { await store.automatic(item.checked); status = ''; }).then(scheduleCheck); } },
        { label: 'Use specific version', enabled: !busy, submenu: [
          ...versions,
          { type: 'separator' },
          { label: 'Refresh', click: () => void action(refreshBuilds) },
          { label: 'All builds on GitHub…', click: () => void shell.openExternal(RELEASES) },
        ] },
        ...(needsDesktop ? [{ label: 'Download desktop app…', click: () => void shell.openExternal(`${RELEASES}/tag/latest-build`) }] : []),
        { type: 'separator' },
        { label: label(current) + (busy && status ? ` · ${status}` : ''), enabled: false },
      ];
    },
    rendererReady() {
      if (preview) return;
      if (healthTimer) return;
      healthTimer = setTimeout(async () => {
        try { await store.healthy(); clearTimeout(startupTimer); }
        catch { /* Leave the launch unconfirmed, so a failed save cannot promote it. */ }
      }, 10000);
      healthTimer.unref();
    },
    async cleanExit() {
      stopped = true;
      clearTimeout(startupTimer); clearTimeout(healthTimer); clearTimeout(checkTimer);
      if (!preview) await store.cleanExit();
      if (restartRequested) app.exit(76);
    },
    async fail() {
      if (preview) { app.quit(); return; }
      stopped = true;
      clearTimeout(startupTimer); clearTimeout(healthTimer); clearTimeout(checkTimer);
      if (store.state.active === store.bundled.id) {
        await dialog.showMessageBox({ type: 'error', title: 'Yinamp could not start', message: 'Please download a fresh copy of Yinamp. Your saved library and settings are still on this computer.' });
        app.exit(1); return;
      }
      try { await store.reject(store.state.active, true); relaunch(); }
      catch { relaunch(true); }
      app.exit(1);
    },
    start() {
      if (preview) return;
      startupTimer = setTimeout(() => void controller.fail(), 60000);
      startupTimer.unref();
      void scheduleCheck();
    },
  };
  return controller;
}
