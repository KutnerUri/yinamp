import { gunzipSync, brotliDecompressSync } from 'node:zlib';
// Decode only to identify the search request. Never export its context/headers.
export function searchRequestFields(request) {
  try {
    let text = request.postData;
    if (request.postDataEntries?.some(entry => entry.bytes)) {
      let bytes = Buffer.concat(request.postDataEntries.filter(entry => entry.bytes).map(entry => Buffer.from(entry.bytes, 'base64')));
      if (bytes.length > 1000000) return null;
      const encoding = Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-encoding')?.[1];
      if (encoding === 'gzip' || bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes, { maxOutputLength: 1000000 });
      else if (encoding === 'br') bytes = brotliDecompressSync(bytes, { maxOutputLength: 1000000 });
      text = bytes.toString();
    }
    if (text?.length > 1000000) return null;
    const data = JSON.parse(text || '{}');
    return Object.fromEntries(['query', 'params', 'continuation'].filter(key => typeof data[key] === 'string').map(key => [key, data[key]]));
  } catch { return null; }
}
export function matchingSearchRequest(request, query, params, tokens) {
  try {
    const url = new URL(request.url);
    if (url.origin !== 'https://music.youtube.com' || url.pathname !== '/youtubei/v1/search') return false;
    const fields = searchRequestFields(request);
    const token = fields?.continuation ?? url.searchParams.get('continuation') ?? url.searchParams.get('ctoken');
    if (token) return tokens.has(token);
    return fields?.query === query && decodeURIComponent(fields.params ?? '') === decodeURIComponent(params);
  } catch { return false; }
}
