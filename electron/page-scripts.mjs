// These scripts control the ordinary page's HTML media element. No media URLs are extracted.
export function readPage() {
  const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  const player = document.querySelector('#movie_player');
  const isAd = player?.classList.contains('ad-showing') ?? false;
  const error = document.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim() ?? '';
  return {
    id: new URL(location.href).searchParams.get('v'), hasVideo: Boolean(video), error,
    current: isAd ? 0 : video?.currentTime || 0,
    duration: isAd || !Number.isFinite(video?.duration) ? 0 : video.duration,
    volume: typeof player?.getVolume === 'function' ? player.getVolume() : video ? video.volume * 100 : 75,
    muted: typeof player?.isMuted === 'function' ? player.isMuted() : video?.muted ?? false,
    state: !video ? 3 : video.ended && !isAd ? 0 : video.paused ? 2 : video.readyState < 3 || isAd ? 3 : 1,
    ready: Boolean(video && video.readyState >= 1), isAd,
  };
}
export function controlPage(command) {
  const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  const player = document.querySelector('#movie_player');
  if (!video) return { waiting: true };
  if (command.type === 'play') return video.play().then(() => ({ ok: true })).catch(error => ({ blocked: error.name === 'NotAllowedError', error: error.message }));
  if (command.type === 'pause') video.pause();
  if (command.type === 'stop') { video.pause(); video.currentTime = 0; }
  if (command.type === 'seek') video.currentTime = Math.min(command.value, Number.isFinite(video.duration) ? video.duration : command.value);
  if (command.type === 'volume') {
    // The page player may normalize the HTML element's volume; prefer its own user-facing level.
    if (typeof player?.setVolume === 'function') player.setVolume(command.value);
    else video.volume = command.value / 100;
    if (command.muted && typeof player?.mute === 'function') player.mute();
    else if (!command.muted && typeof player?.unMute === 'function') player.unMute();
    else video.muted = command.muted === true;
  }
  return { ok: true };
}
// Fit the normal watch-page player in the panel, retaining its native controls and ad playback.
export const playerLayoutCSS = `
html,body{margin:0!important;overflow:hidden!important;background:#080e08!important}
ytd-masthead,#guide,#secondary,#below,#comments,ytd-watch-next-secondary-results-renderer{display:none!important}
ytd-app,ytd-page-manager,ytd-watch-flexy,#columns,#primary,#primary-inner,#player,#player-container-outer{margin:0!important;padding:0!important;width:100%!important;max-width:none!important;min-width:0!important;height:100%!important}
#player-container-inner{position:fixed!important;inset:0!important;padding:0!important;height:100%!important;width:100%!important}
#movie_player{position:fixed!important;inset:0!important;z-index:1000!important;width:100vw!important;height:100vh!important;background:#000!important}
.html5-video-container{width:100%!important;height:100%!important}
video.html5-main-video{width:100%!important;height:100%!important;top:0!important;left:0!important;object-fit:contain!important}
`;
export const snapshotScript = `(${readPage.toString()})()`;
export const commandScript = command => `(${controlPage.toString()})(${JSON.stringify(command)})`;
