// Only loaded by the static Pages build. The local and desktop apps keep their APIs.
import { demoAPIResponse } from './pages-api.js';
import { setupDesktopDownload } from './downloads.js';

void setupDesktopDownload(navigator, document);

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    return Promise.resolve(demoAPIResponse(url));
  }
  return nativeFetch(input, options);
};
await import('./app.js');
