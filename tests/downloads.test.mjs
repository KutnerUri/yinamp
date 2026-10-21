import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopDownload, setupDesktopDownload } from '../src/downloads.js';

test('downloads target supported Windows and Linux machines', () => {
  assert.match(desktopDownload({ userAgent: 'Windows NT 10.0; Win64; x64' }).href, /win-x64.exe$/);
  assert.match(desktopDownload({ platform: 'Linux x86_64' }).href, /linux-x64.AppImage$/);
  assert.match(desktopDownload({ platform: 'Windows', architecture: 'x86', bitness: '64' }).href, /win-x64.exe$/);
});

test('MacIntel is ambiguous until explicit architecture hints arrive', () => {
  assert.equal(desktopDownload({ platform: 'MacIntel' }).macChoices, true);
  assert.match(desktopDownload({ platform: 'macOS', architecture: 'arm', bitness: '64' }).href, /mac-arm64.dmg$/);
  assert.match(desktopDownload({ platform: 'macOS', architecture: 'x86', bitness: '64' }).href, /mac-x64.dmg$/);
});

test('mobile, ARM Linux/Windows, 32-bit and unknown devices get the full list', () => {
  for (const hints of [{ userAgent: 'Android Linux x86_64' }, { userAgent: 'iPhone Mac OS X' }, { platform: 'MacIntel', maxTouchPoints: 5 }, { platform: 'Linux aarch64' }, { platform: 'Windows', architecture: 'arm', bitness: '64' }, { platform: 'Windows', bitness: '32' }, {}]) {
    assert.match(desktopDownload(hints).href, /tag\/latest-build$/);
  }
});

test('denied architecture hints preserve Mac choices and the release fallback', async () => {
  const link = {}, mac = {};
  const document = { querySelector: selector => selector === '#desktop-download' ? link : mac };
  await setupDesktopDownload({ platform: 'MacIntel', userAgent: '', userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } } }, document);
  assert.equal(link.hidden, true);
  assert.equal(mac.hidden, false);
  assert.match(link.href, /tag\/latest-build$/);
});
