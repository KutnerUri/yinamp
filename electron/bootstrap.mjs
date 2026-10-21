// This launcher stays inside the installed bundle. Updated application code lives beside user data.
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UpdateStore, createDevelopmentUpdateStore } from './update-store.mjs';
import { createUpdateController } from './update-controller.mjs';

app.setName('Yinamp');
const profile = process.argv.find(value => value.startsWith('--profile='));
if (profile) app.setPath('userData', resolve(profile.slice('--profile='.length)));
const bundledRoot = fileURLToPath(new URL('../', import.meta.url));
if (!app.isPackaged) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const store = createDevelopmentUpdateStore({ version: pkg.version, electron: process.versions.electron, platform: `${process.platform}-${process.arch}` });
  globalThis[Symbol.for('yinamp.updates')] = createUpdateController(store, { preview: true });
  await import('./main.mjs');
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--yinamp-bundled')) {
  await import('./main.mjs');
} else {
  let controller;
  try {
    const bundled = JSON.parse(await readFile(new URL('../build-info.json', import.meta.url), 'utf8'));
    const store = await new UpdateStore({
      directory: join(app.getPath('userData'), 'updates'), userData: app.getPath('userData'),
      bundled, bundledRoot, electron: process.versions.electron, platform: `${process.platform}-${process.arch}`,
    }).load();
    const root = await store.begin();
    controller = createUpdateController(store);
    globalThis[Symbol.for('yinamp.updates')] = controller;
    controller.start();
    await import(pathToFileURL(join(root, 'electron/main.mjs')).href);
  } catch (error) {
    if (controller) await controller.fail();
    else {
      // Updater storage trouble must not prevent the original application from opening.
      console.error('Updates unavailable:', error.message);
      await import('./main.mjs');
    }
  }
}
