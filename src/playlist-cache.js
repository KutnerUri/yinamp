export const PLAYLIST_CACHE_MS = 30 * 60 * 1000;

export class PlaylistCache {
  constructor({ ttl = PLAYLIST_CACHE_MS, maxEntries = 200, now = Date.now } = {}) {
    this.ttl = ttl; this.maxEntries = maxEntries; this.now = now; this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.time >= this.ttl) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value) {
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { time: this.now(), value });
  }
  clear() { this.entries.clear(); }
}
