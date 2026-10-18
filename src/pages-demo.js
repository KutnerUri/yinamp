// Only loaded by the static Pages build. The local and desktop apps keep their APIs.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    const suggestions = url.pathname === '/api/search-suggestions';
    return Promise.resolve(new Response(JSON.stringify(suggestions ? [] : {
      error: 'This browser demo has no music search server. Use + ADD with a YouTube video link, or run Yinamp locally for search and discovery.',
    }), { status: suggestions ? 200 : 503, headers: { 'Content-Type': 'application/json' } }));
  }
  return nativeFetch(input, options);
};
await import('./app.js');
