let apiPromise;

export function loadYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      apiPromise = undefined;
      reject(new Error('YouTube could not connect. Check your connection, then press Retry.'));
    };
    window.onYouTubeIframeAPIReady = () => { clearTimeout(timer); previous?.(); resolve(window.YT); };
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
  constructor({ onState, onError, onReady, onAutoplayBlocked }) {
    this.handlers = { onState, onError, onReady, onAutoplayBlocked };
    this.ready = false;
    this.pending = null;
    this.initializing = false;
    this.generation = 0;
    this.cued = false;
    this.playWhenCued = false;
  }
  async initialize() {
    if (this.initializing) return;
    this.initializing = true;
    this.ready = false;
    clearTimeout(this.readyTimer);
    const generation = ++this.generation;
    this.player?.destroy();
    this.player = null;
    const container = document.getElementById('youtube-host');
    container.replaceChildren(Object.assign(document.createElement('div'), { id: 'youtube-player' }));
    try {
      const YT = await loadYouTubeAPI();
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
            if (event.data === 5 || event.data === 1) this.cued = true;
            if (event.data === 1) this.playWhenCued = false;
            this.handlers.onState(event.data);
            if (event.data === 5 && this.playWhenCued) { this.playWhenCued = false; this.player.playVideo(); }
          },
          onError: event => { if (generation === this.generation) { this.playWhenCued = false; this.handlers.onError(youtubeErrors[event.data] ?? 'YouTube could not play this video. Try another link.'); } },
          onAutoplayBlocked: () => this.handlers.onAutoplayBlocked(),
        },
      });
      this.readyTimer = setTimeout(() => {
        if (generation !== this.generation || this.ready) return;
        this.initializing = false;
        this.handlers.onError('YouTube did not respond. Check your connection, then press Retry.');
      }, 18000);
    } catch (error) {
      this.initializing = false;
      this.handlers.onError(error.message);
    }
  }
  load(track, autoplay = false) {
    this.playWhenCued = autoplay;
    if (!track) { this.pending = null; if (this.ready) this.player.stopVideo(); return; }
    if (!this.ready) { this.pending = { track, autoplay }; return; }
    const parameters = { videoId: track.id, startSeconds: track.start ?? 0 };
    this.cued = false;
    this.player[autoplay ? 'loadVideoById' : 'cueVideoById'](parameters);
  }
  play() { if (this.ready) { if (this.cued) this.player.playVideo(); else this.playWhenCued = true; } }
  pause() { this.playWhenCued = false; if (this.ready) this.player.pauseVideo(); }
  stop() { this.pending = null; this.playWhenCued = false; if (this.ready) { this.player.pauseVideo(); this.player.seekTo(0, true); this.player.pauseVideo(); } }
  seek(seconds) { if (this.ready) this.player.seekTo(seconds, true); }
  volume(value, muted) { if (this.ready) { this.player.setVolume(value); this.player[muted ? 'mute' : 'unMute'](); } }
  progress() { return this.ready ? { current: this.player.getCurrentTime() || 0, duration: this.player.getDuration() || 0, volume: this.player.getVolume(), muted: this.player.isMuted() } : { current: 0, duration: 0 }; }
  destroy() { this.generation++; clearTimeout(this.readyTimer); this.player?.destroy(); }
}
