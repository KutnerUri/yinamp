import { SPECTRUM_INTERVAL_MS } from './spectrum-config.js';
export { SPECTRUM_INTERVAL_MS } from './spectrum-config.js';

export function setupVisualizer(element, { simulated = false } = {}) {
  const phi = (1 + Math.sqrt(5)) / 2;
  const interval = simulated ? SPECTRUM_INTERVAL_MS * 2 : SPECTRUM_INTERVAL_MS;
  const bars = Array.from({ length: 20 }, () => document.createElement('span'));
  element.append(...bars);
  let target = bars.map(() => 0), shown = [...target];
  let frame = 0, previous = 0, lastSample = 0, active = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const variation = bars.map(() => 0);
  const simulatedBands = (now = performance.now()) => {
    const time = reducedMotion.matches ? 0 : now / 1000;
    const pulse = 0.55 + 0.2 * Math.sin(time * 2.4) + 0.1 * Math.sin(time * 0.7);
    return bars.map((_, index) => {
      // Shared pulse and broad waves keep neighboring bands moving together.
      const wave = 0.55 + 0.25 * Math.sin(index * 0.45 - time * 1.2)
        + 0.15 * Math.sin(index * 0.8 + time * 0.65);
      variation[index] = reducedMotion.matches ? 0 : variation[index] * 0.7 + (Math.random() - 0.5) * 0.12;
      return Math.max(0.08, Math.min(0.95, 0.12 + pulse * wave + variation[index]));
    });
  };
  const lit = bars.map(() => -1);
  const paint = () => bars.forEach((bar, index) => {
    const blocks = Math.round(shown[index] * 8);
    if (lit[index] === blocks) return;
    lit[index] = blocks;
    // Reveal whole 2 px LEDs on a 3 px pitch; never scale the pattern.
    bar.style.clipPath = `inset(${blocks ? (8 - blocks) * 3 : 23}px 0 0)`;
  });
  function draw(now) {
    frame = 0;
    if (document.hidden) return;
    const elapsed = now - previous;
    if (elapsed >= interval || simulated && reducedMotion.matches) {
      // Standard elapsed-time rAF cap. Carry remainder to prevent timing drift;
      // perform one update, never catch up with a burst after a blocked frame.
      previous = now - (elapsed % interval);
      if (simulated && active) target = simulatedBands(now);
      if (!simulated && now - lastSample > 1500) { active = false; target.fill(0); }
      shown = shown.map((value, index) => {
        const next = target[index];
        const smoothing = simulated ? active ? (next > value ? 1 / phi : 1 / phi ** 3) : 0.55 : next > value ? 0.75 : 0.4;
        return reducedMotion.matches ? next : value + (next - value) * smoothing;
      });
      paint();
    }
    const animating = active ? !simulated || !reducedMotion.matches : shown.some(value => value > 0.001);
    if (animating) frame = requestAnimationFrame(draw);
    else if (!active) { shown.fill(0); paint(); }
  }
  const wake = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw); };
  function update(sample = { active: false, bands: [] }) {
    active = sample.active === true;
    target = bars.map((_, index) => active && Number.isFinite(sample.bands?.[index]) ? Math.max(0, Math.min(1, sample.bands[index])) : 0);
    lastSample = performance.now();
    if (!active && shown.every(value => value <= 0.001)) return;
    wake();
  }
  function setPlaying(playing) {
    if (simulated) update({ active: playing, bands: playing ? simulatedBands() : [] });
  }
  const motion = () => { if (simulated && active) setPlaying(true); };
  reducedMotion.addEventListener?.('change', motion);
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
  document.addEventListener('visibilitychange', visibility);
  paint();
  return { update, setPlaying, destroy() { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); reducedMotion.removeEventListener?.('change', motion); } };
}
