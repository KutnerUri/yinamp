let apiPromise;
let cancelAPILoad;

export function loadYouTubeAPI({ fresh = false } = {}) {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (fresh) cancelAPILoad?.();
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      cancelAPILoad = undefined;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
      script.onerror = null;
    };
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script.remove();
      apiPromise = undefined;
      reject(new Error('YouTube could not connect. Check your connection, then press Retry.'));
    };
    const ready = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(window.YT);
      try { previous?.(); } catch { /* Another API consumer must not strand this player. */ }
    };
    cancelAPILoad = fail;
    window.onYouTubeIframeAPIReady = ready;
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.append(script);
  });
  return apiPromise;
}

export const youtubeErrors = {
  2: 'YouTube could not read this video link.',
  5: 'YouTube could not play this video in your browser.',
  100: 'This video is private, removed, or unavailable.',
  101: 'This video’s owner has disabled embedded playback.',
  150: 'This video’s owner has disabled embedded playback.',
  153: 'YouTube could not identify this player. Open Yinamp through its local server.',
};

export class YouTubePlayer {
  constructor({ onState, onError, onReady, onAutoplayBlocked, onReconnecting }) {
    this.handlers = { onState, onError, onReady, onAutoplayBlocked, onReconnecting };
    this.ready = false;
    this.pending = null;
    this.initializing = false;
    this.generation = 0;
    this.cued = false;
    this.playWhenCued = false;
  }
  async initialize({ reconnect = false } = {}) {
    this.initializing = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    clearTimeout(this.reconnectTimer);
    const startedAt = Date.now();
    const generation = ++this.generation;
    this.player?.destroy();
    this.player = null;
    const fail = (message, details, retryable = false, timedOut = false) => {
      if (generation !== this.generation) return;
      clearTimeout(this.readyTimer);
      this.generation++;
      this.initializing = false;
      this.ready = false;
      this.playWhenCued = false;
      this.player?.destroy();
      this.player = null;
      cancelAPILoad?.();
      if (retryable && !reconnect) {
        const retiredGeneration = this.generation;
        const retry = () => {
          if (retiredGeneration !== this.generation) return;
          this.handlers.onReconnecting?.();
          void this.initialize({ reconnect: true });
        };
        const delay = timedOut ? 0 : Math.max(0, 6000 - (Date.now() - startedAt));
        if (delay) this.reconnectTimer = setTimeout(retry, delay);
        else retry();
        return;
      }
      this.handlers.onError(message, details);
    };
    // Two bounded attempts: reconnect once at six seconds, then offer manual Retry.
    this.readyTimer = setTimeout(() => fail('YouTube did not respond. Check your connection, then press Retry.', undefined, true, true), 6000);
    const container = document.getElementById('youtube-host');
    container.replaceChildren(Object.assign(document.createElement('div'), { id: 'youtube-player' }));
    try {
      const YT = await loadYouTubeAPI({ fresh: reconnect });
      if (generation !== this.generation) return;
      const initialTrack = this.pending?.track;
      this.player = new YT.Player('youtube-player', {
        width: '100%', height: '100%',
        videoId: initialTrack?.id,
        playerVars: { origin: location.origin, playsinline: 1, controls: 1, rel: 0, start: initialTrack?.start ?? 0 },
        events: {
          onReady: event => {
            if (generation !== this.generation) return;
            this.player = event.target;
            this.ready = true;
            this.initializing = false;
            this.cued = Boolean(initialTrack);
            clearTimeout(this.readyTimer);
            const iframe = this.player.getIframe();
            iframe.title = 'YouTube video player';
            iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
            this.handlers.onReady();
            if (this.pending) {
              const { track, autoplay } = this.pending;
              this.pending = null;
              if (track.id !== initialTrack?.id || autoplay) this.load(track, autoplay);
            }
          },
          onStateChange: event => {
            if (generation !== this.generation) return;
            if (this.switchTarget && (this.player.getVideoData?.()?.video_id !== this.switchTarget || event.data === 0)) return;
            if (this.switchTarget && [1, 2, 5].includes(event.data)) this.switchTarget = null;
            if (event.data === 5 || event.data === 1) this.cued = true;
            if (event.data === 1) this.playWhenCued = false;
            this.handlers.onState(event.data);
            if (event.data === 5 && this.playWhenCued) { this.playWhenCued = false; this.player.playVideo(); }
          },
          onError: event => {
            if (generation !== this.generation) return;
            const message = youtubeErrors[event.data] ?? 'YouTube could not play this video. Try another link.';
            const details = { code: event.data };
            if (!this.ready) { fail(message, details); return; }
            this.playWhenCued = false;
            this.handlers.onError(message, details);
          },
          onAutoplayBlocked: () => { if (generation === this.generation) this.handlers.onAutoplayBlocked(); },
        },
      });
    } catch (error) {
      fail(error.message, undefined, true);
    }
  }
  load(track, autoplay = false) {
    this.switchTarget = null;
    this.playWhenCued = autoplay;
    if (!track) { this.pending = null; if (this.ready) this.player.stopVideo(); return; }
    if (!this.ready) { this.pending = { track, autoplay }; return; }
    const parameters = { videoId: track.id, startSeconds: track.start ?? 0 };
    this.cued = false;
    this.player[autoplay ? 'loadVideoById' : 'cueVideoById'](parameters);
  }
  switchRecording(track, autoplay) {
    this.load(track, autoplay);
    this.switchTarget = track.id;
  }
  play() { if (this.ready) { if (this.cued) this.player.playVideo(); else this.playWhenCued = true; } }
  pause() { this.playWhenCued = false; if (this.pending) this.pending.autoplay = false; if (this.ready) this.player.pauseVideo(); }
  stop() { this.pending = null; this.playWhenCued = false; if (this.ready) { this.player.pauseVideo(); this.player.seekTo(0, true); this.player.pauseVideo(); } }
  seek(seconds) { if (this.ready) this.player.seekTo(seconds, true); }
  volume(value, muted) { if (this.ready) { this.player.setVolume(value); this.player[muted ? 'mute' : 'unMute'](); } }
  progress() { return this.ready ? { current: this.player.getCurrentTime() || 0, duration: this.player.getDuration() || 0, volume: this.player.getVolume(), muted: this.player.isMuted() } : { current: 0, duration: 0 }; }
  destroy() { this.generation++; clearTimeout(this.readyTimer); clearTimeout(this.reconnectTimer); this.ready = false; this.initializing = false; this.player?.destroy(); this.player = null; }
}
