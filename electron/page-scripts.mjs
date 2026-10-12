// These scripts control the ordinary page's HTML media element. No media URLs are extracted.
export function didProviderAdvance(data, requestedId, initialized, providerPage) {
  return Boolean(requestedId && !data.isAd && (data.endedId === requestedId || initialized && providerPage && data.id && data.id !== requestedId));
}

export function readPage() {
  const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  const player = document.querySelector('#movie_player');
  const id = player?.getVideoData?.()?.video_id || new URL(location.href).searchParams.get('v');
  if (video?.addEventListener && globalThis.__yinampEndVideo !== video) {
    globalThis.__yinampEndVideo = video;
    video.addEventListener('ended', () => {
      if (video.__yinampObservedAd || player?.classList.contains('ad-showing')) return;
      globalThis.__yinampEndedId = video.__yinampObservedId;
    }, true);
  }
  if (video) video.__yinampObservedId = id;
  const endedId = globalThis.__yinampEndedId;
  delete globalThis.__yinampEndedId;
  const isAd = player?.classList.contains('ad-showing') ?? false;
  if (video) video.__yinampObservedAd = isAd;
  const cued = player?.getPlayerState?.() === 5;
  const error = document.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim() ?? '';
  return {
    id, endedId, hasVideo: Boolean(video), error,
    current: isAd ? 0 : cued ? player.getCurrentTime() || 0 : video?.currentTime || 0,
    duration: isAd || !Number.isFinite(video?.duration) ? 0 : video.duration,
    volume: globalThis.__yinampAudio?.volume ?? (typeof player?.getVolume === 'function' ? player.getVolume() : video ? video.volume * 100 : 75),
    muted: globalThis.__yinampAudio?.muted ?? (typeof player?.isMuted === 'function' ? player.isMuted() : video?.muted ?? false),
    state: cued ? 5 : !video ? 3 : video.ended && !isAd ? 0 : video.paused ? 2 : video.readyState < 3 || isAd ? 3 : 1,
    ready: cued || Boolean(video && video.readyState >= 1), isAd,
  };
}
export function controlPage(command) {
  const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  const player = document.querySelector('#movie_player');
  const autonav = document.querySelector('.ytp-autonav-toggle-button');
  if (autonav?.getAttribute?.('aria-checked') === 'true') autonav.click();
  if (command.type === 'switch') {
    const method = command.autoplay ? 'loadVideoById' : 'cueVideoById';
    if (typeof player?.[method] !== 'function') return { error: 'This player could not switch recordings. Click VID to retry.' };
    player[method]({ videoId: command.id, startSeconds: command.start ?? 0 });
    return { switched: true };
  }
  if (!video) return { waiting: true };
  if (command.type === 'play') {
    void globalThis.__yinampAudio?.context.resume().catch(() => {});
    if (player?.getPlayerState?.() === 5 && typeof player?.playVideo === 'function') { player.playVideo(); return { ok: true }; }
    return video.play().then(() => ({ ok: true })).catch(error => ({ blocked: error.name === 'NotAllowedError', error: error.message }));
  }
  if (command.type === 'pause') { if (typeof player?.pauseVideo === 'function') player.pauseVideo(); else video.pause(); }
  if (command.type === 'stop') { video.pause(); video.currentTime = 0; }
  if (command.type === 'seek') video.currentTime = Math.min(command.value, Number.isFinite(video.duration) ? video.duration : command.value);
  if (command.type === 'volume') {
    if (globalThis.__yinampAudio) { globalThis.__yinampAudio.setVolume(command.value, command.muted === true); globalThis.__yinampAudio.attach(video); return { ok: true }; }
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
