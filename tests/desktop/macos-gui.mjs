import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Test-only preflight: sandboxed AppKit startup can abort before Electron can
// report an error. Fail explicitly instead of spawning it and creating a crash dialog.
export async function requireMacOSGUI() {
  if (process.platform !== 'darwin') return;
  const directory = await mkdtemp(join(tmpdir(), 'yinamp-gui-preflight-'));
  try {
    const executable = join(directory, 'probe');
    const source = fileURLToPath(new URL('./macos-gui-probe.c', import.meta.url));
    await run('/usr/bin/clang', [source, '-o', executable], { timeout: 15000 });
    try {
      await run(executable, [], { timeout: 5000 });
    } catch (error) {
      if (error.code !== 77) throw error;
      throw new Error(`macOS GUI test blocked: this execution environment denies Launch Services or WindowServer access. Electron was not launched. Run on a native Mac CI runner or from an unrestricted Terminal session.\n${error.stderr.trim()}`);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
