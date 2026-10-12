// Installed once per watch-page navigation. The page keeps the audio graph;
// subsequent 20 Hz reads execute only the small sample call below.
export async function installAudioSpectrum(settings) {
  if (window.__yinampAudio) { window.__yinampAudio.setVolume(settings.volume, settings.muted); return true; }
  const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  if (!video) return false;
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.65;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -20;
  const gain = context.createGain();
  gain.gain.value = settings.muted ? 0 : settings.volume / 100;
  analyser.connect(gain); gain.connect(context.destination);
  const frequency = new Uint8Array(analyser.frequencyBinCount);
  const ranges = Array.from({ length: 20 }, (_, index) => {
    const first = Math.max(1, Math.floor(40 * 400 ** (index / 20) * analyser.fftSize / context.sampleRate));
    const last = Math.min(frequency.length, Math.max(first + 1, Math.ceil(40 * 400 ** ((index + 1) / 20) * analyser.fftSize / context.sampleRate)));
    return [first, last];
  });
  const sources = new WeakMap();
  let currentVideo, currentSource;
  const graph = {
    context, analyser, gain, volume: settings.volume, muted: settings.muted,
    setVolume(volume, muted) {
      this.volume = volume; this.muted = muted;
      gain.gain.setTargetAtTime(muted ? 0 : volume / 100, context.currentTime, 0.015);
    },
    attach(video) {
      if (video !== currentVideo) {
        const source = sources.get(video) ?? context.createMediaElementSource(video);
        currentSource?.disconnect(); source.connect(analyser); sources.set(video, source);
        currentSource = source; currentVideo = video;
      }
      const player = document.querySelector('#movie_player');
      if (typeof player?.getVolume === 'function' && player.getVolume() !== 100) player.setVolume(100);
      if (typeof player?.isMuted === 'function' && player.isMuted()) player.unMute();
      if (video.volume !== 1) video.volume = 1;
      if (video.muted) video.muted = false;
    },
    sample() {
      const video = document.querySelector('video.html5-main-video') ?? document.querySelector('video');
      if (!video) return { active: false, bands: [] };
      this.attach(video);
      const active = !video.paused && !video.ended && video.readyState >= 3 && context.state === 'running';
      if (!active) return { active: false, bands: [] };
      analyser.getByteFrequencyData(frequency);
      const bands = ranges.map(([first, last]) => {
        let sum = 0;
        for (let bin = first; bin < last; bin++) sum += frequency[bin] ** 2;
        return Math.sqrt(sum / (last - first)) / 255;
      });
      return { active: true, bands };
    },
  };
  try {
    graph.attach(video);
    window.__yinampAudio = graph;
    await context.resume();
    return true;
  } catch (error) {
    // Preserve the connected route if attachment succeeded; otherwise leave
    // ordinary media playback in control and dispose of the unused context.
    if (!currentSource) { await context.close(); throw error; }
    return false;
  }
}
export const installSpectrumScript = settings => `(${installAudioSpectrum.toString()})(${JSON.stringify(settings)})`;
export const readSpectrumScript = 'window.__yinampAudio?.sample() ?? { active: false, bands: [] }';
export const spectrumVolumeCSS = '.ytp-volume-area{display:none!important}';
