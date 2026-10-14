// Allow a short loading mismatch, then reload once. Ads are not track changes.
export function createPlaybackOwnership({ graceMs = 2000 } = {}) {
  let mismatchSince = null, recovered = false;
  return {
    reset() { mismatchSince = null; recovered = false; },
    check(data, requestedId, now = Date.now()) {
      if (!requestedId || data.isAd || !data.id || data.id === requestedId) { mismatchSince = null; return null; }
      mismatchSince ??= now;
      if (now - mismatchSince < graceMs) return null;
      mismatchSince = null;
      if (!recovered) { recovered = true; return 'reload'; }
      return 'error';
    },
  };
}
