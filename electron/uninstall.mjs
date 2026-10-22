import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// The native launcher performs cleanup only after Electron has exited.
export const uninstallConfirmation = {
  message: 'Uninstall Yinamp?',
  detail: 'Yinamp and all its local data will be moved to Trash, including downloaded Electron versions, app updates, saved playlists, settings, and sign-in data.',
};

async function nativeConfirmation() {
  const { stdout } = await promisify(execFile)(process.env.YINAMP_NATIVE_UNINSTALL_HELPER,
    ['--confirm-uninstall', uninstallConfirmation.message, uninstallConfirmation.detail]);
  return stdout.trim() === 'uninstall';
}

let confirming = false;
export async function confirmUninstall({ dialog, app, window, confirm = nativeConfirmation }) {
  if (confirming) return;
  confirming = true;
  try {
    if (await confirm()) app.exit(78);
  } catch {
    await dialog.showMessageBox(window, { type: 'error', message: 'Yinamp could not open the uninstall confirmation.', detail: 'Nothing has been removed.' });
  } finally {
    confirming = false;
  }
}
