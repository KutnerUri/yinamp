export class NativePlayer {
  constructor(handlers) {
    this.handlers = handlers;
    this.bridge = window.yinampDesktop;
    this.ready = false;
    this.pending = null;
    this.data = { current: 0, duration: 0, volume: 75, muted: false };
    this.lastState = null;
    this.unsubscribe = this.bridge.onPlayer(event => {
      if (event.type === 'snapshot') {
        if (this.switchTarget && (event.data.id !== this.switchTarget || event.data.state === 0)) return;
        if (this.switchTarget && [1, 2, 5].includes(event.data.state)) this.switchTarget = null;
        this.data = event.data;
        if ([0, 2].includes(event.data.state)) this.handlers.onSpectrum?.({ active: false, bands: [] });
        if (event.data.state !== this.lastState) { this.lastState = event.data.state; this.handlers.onState(event.data.state); }
      } else if (event.type === 'spectrum') this.handlers.onSpectrum?.(event.data);
      else if (event.type === 'error') this.handlers.onError(event.message, { code: event.code });
      else if (event.type === 'autoplay-blocked') this.handlers.onAutoplayBlocked();
      else if (event.type === 'fullscreen' && !event.enabled) document.body.classList.remove('native-video-fullscreen');
    });
    document.body.classList.add('native-desktop');
    document.querySelector('.source-info span:last-child').textContent = 'DESKTOP';
    this.trackLayout();
  }
  send(command) { return this.bridge.player(command).catch(error => this.handlers.onError(error.message, { unchanged: command.type === 'switch' })); }
  async initialize() {
    this.ready = false;
    await this.send({ type: 'initialize' });
    this.ready = true;
    this.handlers.onReady();
    if (this.pending) { const { track, autoplay } = this.pending; this.pending = null; this.load(track, autoplay); }
  }
  load(track, autoplay = false) {
    this.switchTarget = null;
    if (!this.ready) { this.pending = { track, autoplay }; return; }
    this.lastState = null;
    this.data = { ...this.data, current: 0, duration: 0 };
    this.send({ type: 'load', id: track?.id ?? null, start: track?.start ?? 0, autoplay, mode: track?.mode });
  }
  switchRecording(track, autoplay) {
    this.switchTarget = track.id;
    this.lastState = null;
    this.send({ type: 'switch', id: track.id, start: track.start ?? 0, autoplay, mode: track.mode, retry: track.retry === true }).then(result => {
      if (result?.error) {
        this.switchTarget = null;
        this.handlers.onError(result.error, { unchanged: result.unchanged });
      }
    });
  }
  play() { this.send({ type: 'play' }); }
  pause() { this.send({ type: 'pause' }); }
  stop() { this.send({ type: 'stop' }); }
  seek(value) { this.send({ type: 'seek', value }); }
  volume(value, muted) { this.send({ type: 'volume', value, muted }); }
  progress() { return this.data; }
  fullscreen() {
    document.body.classList.toggle('native-video-fullscreen');
    this.send({ type: 'fullscreen', enabled: document.body.classList.contains('native-video-fullscreen') });
  }
  trackLayout() {
    let previousBounds = '';
    let frame = 0;
    const viewport = document.getElementById('video-viewport');
    const layoutElements = new Set([document.body, document.getElementById('desktop'), viewport, ...document.querySelectorAll('[data-panel]')]);
    const update = () => {
      frame = 0;
      const rect = viewport.getBoundingClientRect();
      const covered = document.querySelector('dialog[open]') || document.querySelector('.player-window.dragging') || (!document.body.classList.contains('native-video-fullscreen') && [...document.querySelectorAll('[data-panel]')].some(window => {
        if (window.dataset.panel === 'video' || window.hidden) return false;
        const bounds = window.getBoundingClientRect();
        return bounds.left < rect.right && bounds.right > rect.left && bounds.top < rect.bottom && bounds.bottom > rect.top;
      }));
      const bounds = { x: rect.left + 2, y: rect.top + 2, width: Math.max(0, rect.width - 4), height: Math.max(0, rect.height - 4), visible: !covered && document.getElementById('video-placeholder').hidden && rect.top >= 0 && rect.bottom <= innerHeight };
      const key = JSON.stringify(bounds);
      if (key !== previousBounds) { previousBounds = key; this.bridge.layout(bounds); }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const mutations = new MutationObserver(records => {
      // Panel positions use inline styles. Ignore unrelated style changes,
      // particularly the visualizer's continuous bar animation.
      if (records.some(record => record.type !== 'attributes' || record.attributeName !== 'style' || layoutElements.has(record.target))) schedule();
    });
    mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'class', 'style'] });
    const sizes = new ResizeObserver(schedule);
    for (const element of layoutElements) if (element) sizes.observe(element);
    // Capture also covers scrolling inside nested containers.
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', schedule);
    const keydown = event => {
      if (event.key === 'Escape' && document.body.classList.contains('native-video-fullscreen')) this.fullscreen();
    };
    document.addEventListener('keydown', keydown);
    this.stopTrackingLayout = () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('keydown', keydown);
    };
    schedule();
  }
  destroy() { this.stopTrackingLayout?.(); this.unsubscribe?.(); }
}
