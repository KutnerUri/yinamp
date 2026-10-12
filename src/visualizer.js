import { SPECTRUM_INTERVAL_MS } from './spectrum-config.js';
export { SPECTRUM_INTERVAL_MS } from './spectrum-config.js';

export function setupVisualizer(element) {
  const bars = Array.from({ length: 20 }, () => document.createElement('span'));
  element.append(...bars);
  let target = bars.map(() => 0), shown = [...target];
  let frame = 0, previous = 0, lastSample = 0, active = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
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
    if (elapsed >= SPECTRUM_INTERVAL_MS) {
      // Standard elapsed-time rAF cap. Carry remainder to prevent timing drift;
      // perform one update, never catch up with a burst after a blocked frame.
      previous = now - (elapsed % SPECTRUM_INTERVAL_MS);
      if (now - lastSample > 1500) { active = false; target.fill(0); }
      shown = shown.map((value, index) => {
        const next = target[index];
        return reducedMotion.matches ? next : value + (next - value) * (next > value ? 0.75 : 0.4);
      });
      paint();
    }
    if (active || shown.some(value => value > 0.001)) frame = requestAnimationFrame(draw);
    else { shown.fill(0); paint(); }
  }
  const wake = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(draw); };
  function update(sample = { active: false, bands: [] }) {
    active = sample.active === true;
    target = bars.map((_, index) => active && Number.isFinite(sample.bands?.[index]) ? Math.max(0, Math.min(1, sample.bands[index])) : 0);
    lastSample = performance.now();
    if (!active && shown.every(value => value <= 0.001)) return;
    wake();
  }
  const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
  document.addEventListener('visibilitychange', visibility);
  paint();
  return { update, destroy() { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); } };
}
