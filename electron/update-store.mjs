import * as nodeFS from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { UPDATE_DAY_MS, automaticCheckDue, nextUpdateCheck, updateJitter } from './update-schedule.mjs';

// Electron's patched fs sees an ASAR as a directory. Integrity checks and writes
// must use the original filesystem to operate on the archive's actual bytes.
const { mkdir, readFile, writeFile, rename, copyFile, rm } = process.versions.electron
  ? createRequire(import.meta.url)('original-fs').promises : nodeFS;

export const UPDATE_PROTOCOL = 1;
export const REPOSITORY = 'KutnerUri/yinamp';
export const RELEASES = `https://github.com/${REPOSITORY}/releases`;
export const MAX_PAYLOAD = 50 * 1024 * 1024;
const idPattern = /^build-\d+-\d+$/;
export const buildID = value => typeof value === 'string' && idPattern.test(value);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateManifest(value) {
  if (value?.protocol !== UPDATE_PROTOCOL || !buildID(value.id) || !Number.isSafeInteger(value.number) || value.number < 1 || !Number.isSafeInteger(value.attempt) || value.attempt < 1 || !/^[a-f0-9]{40}$/.test(value.commit ?? '') || typeof value.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.electron ?? '') || !value.payloads) throw new Error('Unsupported update information');
  for (const [platform, payload] of Object.entries(value.payloads)) {
    if (!/^(darwin-(arm64|x64)|win32-x64|linux-x64)$/.test(platform) || !/^[a-f0-9]{64}$/.test(payload.sha256 ?? '') || !Number.isSafeInteger(payload.size) || payload.size <= 0 || payload.size > MAX_PAYLOAD || payload.url !== `${RELEASES}/download/${value.id}/Yinamp-${platform}.asar`) throw new Error('Invalid update package');
  }
  return value;
}

export function newer(a, b) { return a.number > (b.number ?? 0) || a.number === b.number && a.attempt > (b.attempt ?? 0); }
export function compatible(manifest, electron, platform) { return manifest.electron === electron && Boolean(manifest.payloads[platform]); }

export function mergeManifests(fragments, commit) {
  if (fragments.length !== 4) throw new Error('All four update packages are required');
  const { payloads: ignored, ...metadata } = fragments[0];
  for (const fragment of fragments) {
    const { payloads, ...other } = validateManifest(fragment);
    if (JSON.stringify(other) !== JSON.stringify(metadata)) throw new Error('Platform builds have different metadata');
  }
  const manifest = validateManifest({ ...metadata, payloads: Object.assign({}, ...fragments.map(item => item.payloads)) });
  if (Object.keys(manifest.payloads).length !== 4 || manifest.commit !== commit) throw new Error('Incomplete build or wrong commit');
  return manifest;
}

// Development previews have no archive paths, install methods, or persistent updater state.
export function createDevelopmentUpdateStore({ version, electron, platform }) {
  const current = { id: 'development', version, number: 0, attempt: 1 };
  return {
    electron, platform,
    state: { active: current.id, previous: null, pending: null, pinned: null, paused: true, recentBuilds: [], failed: [] },
    metadata: (id = current.id) => id === current.id ? current : undefined,
    save: async () => {},
    claimCheck: async ({ manual = false } = {}) => manual,
  };
}

// Atomic writes and immutable payloads keep an interrupted download away from the active app.
export class UpdateStore {
  constructor({ directory, bundled, bundledRoot, electron, platform, userData }) {
    Object.assign(this, { directory, bundled, bundledRoot, electron, platform, userData });
    this.queue = Promise.resolve();
    this.state = { active: bundled.id, previous: null, pending: null, pinned: null, paused: false, builds: {}, failed: [], strikes: {}, launch: null, lastCheckAt: 0, nextCheckAt: 0, recentBuilds: [] };
  }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, 'state.json'), 'utf8'));
      if (parsed.schema !== 1 || typeof parsed.paused !== 'boolean' || !parsed.builds || !Array.isArray(parsed.failed)) throw new Error('Invalid update state');
      for (const [id, manifest] of Object.entries(parsed.builds)) if (validateManifest(manifest).id !== id) throw new Error('Invalid build record');
      for (const key of ['active', 'previous', 'pending', 'pinned']) if (parsed[key] != null && typeof parsed[key] !== 'string') throw new Error('Invalid build selection');
      this.state = { ...this.state, ...parsed, strikes: parsed.strikes ?? {} };
      this.state.recentBuilds = Array.isArray(parsed.recentBuilds) ? parsed.recentBuilds.filter(build => buildID(build?.id) && typeof build.label === 'string').slice(0, 20).map(build => ({ id: build.id, label: build.label.slice(0, 100) })) : [];
    } catch { /* Missing or damaged updater state always permits the bundled app. */ }
    return this;
  }
  save() {
    const data = JSON.stringify({ ...this.state, schema: 1 });
    this.queue = this.queue.catch(() => {}).then(async () => {
      const path = join(this.directory, 'state.json');
      await writeFile(path + '.tmp', data, { mode: 0o600 });
      await rename(path + '.tmp', path);
    });
    return this.queue;
  }
  metadata(id = this.state.active) { return id === this.bundled.id ? this.bundled : this.state.builds[id]; }
  async scheduleCheck(now = Date.now(), random = Math.random) {
    const next = nextUpdateCheck(this.state.lastCheckAt, this.state.nextCheckAt, now, random);
    if (this.state.nextCheckAt !== next) { this.state.nextCheckAt = next; await this.save(); }
    return next;
  }
  async claimCheck({ manual = false, now = Date.now(), random = Math.random } = {}) {
    if (!manual && (this.state.paused || this.state.pinned || !automaticCheckDue(this.state.lastCheckAt, now) || this.state.nextCheckAt > now)) return false;
    // Record the attempt before any network request, including attempts which later fail.
    this.state.lastCheckAt = now;
    this.state.nextCheckAt = now + UPDATE_DAY_MS + updateJitter(random);
    await this.save();
    return true;
  }
  archive(id) { if (!buildID(id)) throw new Error('Invalid build ID'); return join(this.directory, `${id}.asar`); }
  async verify(id) {
    if (id === this.bundled.id) return true;
    const info = this.state.builds[id];
    if (!info || !compatible(info, this.electron, this.platform)) return false;
    try {
      const bytes = await readFile(this.archive(id));
      const expected = info.payloads[this.platform];
      return bytes.length === expected.size && digest(bytes) === expected.sha256;
    } catch { return false; }
  }
  async snapshot() {
    if (!this.userData) return;
    try { await copyFile(join(this.userData, 'yinamp-state.json'), join(this.directory, 'pre-update-state.json')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await rm(join(this.directory, 'pre-update-state.json'), { force: true }); }
  }
  async restoreSnapshot() {
    if (!this.userData) return;
    try {
      const source = join(this.directory, 'pre-update-state.json');
      await copyFile(source, join(this.userData, 'yinamp-state.json.recovery'));
      await rename(join(this.userData, 'yinamp-state.json.recovery'), join(this.userData, 'yinamp-state.json'));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async reject(id, restore = false) {
    this.state.failed = [...new Set([...this.state.failed, id])].slice(-100);
    const fallback = this.state.previous;
    this.state.active = fallback && fallback !== id && await this.verify(fallback) ? fallback : this.bundled.id;
    this.state.previous = null;
    this.state.pending = null;
    if (this.state.pinned === id) this.state.pinned = this.state.active;
    this.state.launch = null;
    if (restore) await this.restoreSnapshot();
    await this.save();
  }
  async begin() {
    if (!this.state.pinned && newer(this.bundled, this.metadata() ?? {})) {
      this.state.active = this.bundled.id;
      this.state.previous = null;
      this.state.pending = null;
      this.state.launch = null;
    }
    const last = this.state.launch;
    if (last && last.id === this.state.active && !last.clean && this.state.active !== this.bundled.id) {
      this.state.strikes[last.id] = (this.state.strikes[last.id] ?? 0) + 1;
      if (!last.healthy || this.state.strikes[last.id] >= 2) await this.reject(last.id, !last.healthy);
    }
    if (this.state.pending && (!this.state.pinned || this.state.pinned === this.state.pending)) {
      const pending = this.state.pending;
      this.state.pending = null;
      if (await this.verify(pending)) {
        await this.snapshot();
        this.state.previous = this.state.active;
        this.state.active = pending;
      } else this.state.failed.push(pending);
    }
    if (!await this.verify(this.state.active)) await this.reject(this.state.active);
    this.state.launch = { id: this.state.active, healthy: false, clean: false };
    await this.save();
    return this.state.active === this.bundled.id ? this.bundledRoot : this.archive(this.state.active);
  }
  async healthy() {
    if (this.state.launch) this.state.launch.healthy = true;
    await this.save();
    const keep = new Set([this.state.active, this.state.previous, this.state.pending, this.state.pinned]);
    for (const id of Object.keys(this.state.builds)) {
      if (!keep.has(id)) {
        await rm(this.archive(id), { force: true });
        delete this.state.builds[id];
      }
    }
    await this.save();
  }
  async cleanExit() {
    if (this.state.launch) this.state.launch.clean = true;
    this.state.strikes[this.state.active] = 0;
    await this.save();
  }
  async lock(enabled) {
    this.state.pinned = enabled ? this.state.active : null;
    if (enabled) this.state.pending = null;
    await this.save();
  }
  async pause(enabled) { this.state.paused = enabled; await this.save(); }
  async automatic(enabled) {
    this.state.paused = !enabled;
    this.state.pinned = enabled ? null : this.state.active;
    this.state.pending = null;
    await this.save();
  }
  async select(id) {
    if (!await this.verify(id)) return false;
    this.state.pending = id === this.state.active ? null : id;
    this.state.pinned = id;
    this.state.paused = true;
    await this.save();
    return true;
  }
  async stage(manifest, bytes, { automatic = false, pin = false } = {}) {
    validateManifest(manifest);
    if (!compatible(manifest, this.electron, this.platform)) throw new Error('This build needs a newer desktop download');
    const payload = manifest.payloads[this.platform];
    if (bytes.length !== payload.size || digest(bytes) !== payload.sha256) throw new Error('The update download did not pass its integrity check');
    if (automatic && (this.state.paused || this.state.pinned || this.state.failed.includes(manifest.id))) return false;
    const path = this.archive(manifest.id);
    // Already-running archives are never replaced, including when selecting an installed build.
    if (manifest.id !== this.state.active) {
      await writeFile(path + '.download', bytes, { mode: 0o600 });
      await rename(path + '.download', path);
    }
    this.state.builds[manifest.id] = manifest;
    this.state.pending = manifest.id === this.state.active ? null : manifest.id;
    if (pin) { this.state.pinned = manifest.id; this.state.paused = true; }
    await this.save();
    return true;
  }
  async rollback() {
    if (!this.state.previous || !await this.verify(this.state.previous)) throw new Error('No previous working build is available');
    this.state.pending = this.state.previous;
    this.state.pinned = this.state.previous;
    await this.save();
  }
}
