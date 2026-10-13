// Keep one search client alive, but never treat a surviving window as proof
// that its renderer or request is healthy. Every use has its own watchdog.
export function createSearchWindow({ createWindow, collect, timeout = 25000, onFailure = () => {} }) {
  let window;
  function discard(candidate = window) {
    if (!candidate) return;
    if (candidate === window) window = undefined;
    if (!candidate.isDestroyed()) candidate.destroy();
  }
  async function run(search, isCurrent) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!isCurrent()) throw Object.assign(new Error('The account changed. Try again.'), { code: 'LIBRARY_CANCELLED' });
      if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
        discard(); window = createWindow();
        const candidate = window;
        // An idle renderer can fail too; do not reuse it on the next request.
        candidate.webContents.once('render-process-gone', () => discard(candidate));
        candidate.webContents.once('unresponsive', () => discard(candidate));
      }
      const candidate = window, contents = candidate.webContents;
      let timer, healthy = true, rejectFailure;
      const failure = new Promise((_resolve, reject) => { rejectFailure = reject; });
      const fail = (code = 'SEARCH_WINDOW_FAILURE') => { healthy = false; rejectFailure(Object.assign(new Error('The search window stopped responding.'), { code: typeof code === 'string' ? code : 'SEARCH_WINDOW_FAILURE' })); };
      const events = ['render-process-gone', 'unresponsive', 'destroyed'];
      for (const event of events) contents.on(event, fail);
      timer = setTimeout(() => fail('SEARCH_WINDOW_TIMEOUT'), timeout);
      try {
        const result = await Promise.race([collect(contents, search.query, search.category, search.pages, () => healthy && candidate === window && isCurrent(), search.onPage), failure]);
        if (!healthy || candidate !== window || !isCurrent()) throw new Error('The search request was interrupted.');
        return result;
      } catch (error) {
        healthy = false; discard(candidate);
        if (!isCurrent()) throw Object.assign(new Error('The account changed. Try again.'), { code: 'LIBRARY_CANCELLED' });
        try { onFailure({ category: search.category, attempt: attempt + 1, code: typeof error.code === 'string' && /^SEARCH_[A-Z_]+$/.test(error.code) ? error.code : 'SEARCH_FAILED' }); } catch {}
        if (attempt === 1) throw Object.assign(new Error('YouTube Music search could not complete after restarting its window. Try again.'), { cause: error, code: error.code ?? 'SEARCH_FAILED' });
      } finally {
        clearTimeout(timer);
        for (const event of events) contents.removeListener(event, fail);
      }
    }
  }
  return { run, dispose: () => discard() };
}
