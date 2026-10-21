const release = 'https://github.com/KutnerUri/yinamp/releases';
const asset = file => `${release}/download/latest-build/Yinamp-latest-${file}`;

// Browsers often report MacIntel on Apple Silicon. Never infer Mac architecture from it.
export function desktopDownload({ platform = '', userAgent = '', architecture = '', bitness = '', model = '', maxTouchPoints = 0 } = {}) {
  const system = `${platform} ${userAgent}`;
  const fallback = { label: 'Download desktop app ↗', href: `${release}/tag/latest-build` };
  if (/Android|iPhone|iPad|iPod/i.test(system) || (/Mac/i.test(system) && maxTouchPoints > 1) || (model && !/Windows|macOS|Linux/i.test(platform))) return fallback;
  if (/Mac/i.test(system)) {
    if (architecture === 'arm' && bitness === '64') return { label: 'Download for macOS · Apple Silicon', href: asset('mac-arm64.dmg') };
    if (architecture === 'x86' && bitness === '64') return { label: 'Download for macOS · Intel', href: asset('mac-x64.dmg') };
    return { ...fallback, macChoices: true };
  }
  // Only link directly to architectures we actually build.
  if (architecture === 'arm' || /aarch64|arm64|armv7/i.test(system) || bitness === '32') return fallback;
  if (/Windows|Win32|Win64/i.test(system) && (bitness === '64' || /Win64|WOW64|x64/i.test(userAgent))) {
    return { label: 'Download for Windows', href: asset('win-x64.exe') };
  }
  if (/Linux/i.test(system) && (bitness === '64' && architecture === 'x86' || /x86_64|amd64/i.test(system))) {
    return { label: 'Download for Linux', href: asset('linux-x64.AppImage') };
  }
  return fallback;
}

export async function setupDesktopDownload(navigator, document) {
  const link = document.querySelector('#desktop-download');
  const mac = document.querySelector('#mac-downloads');
  if (!link || !mac) return;
  const hints = { platform: navigator.platform, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints };
  const render = () => {
    const download = desktopDownload(hints);
    link.textContent = download.label;
    link.href = download.href;
    link.hidden = Boolean(download.macChoices);
    mac.hidden = !download.macChoices;
  };
  render();
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      Object.assign(hints, await navigator.userAgentData.getHighEntropyValues(['platform', 'architecture', 'bitness', 'model']));
      render();
    }
  } catch { /* Keep the conservative browser-based choice if hints are denied. */ }
}
