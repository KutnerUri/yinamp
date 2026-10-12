import { clamp } from './core.js';

export function setupPanels(state, persist) {
  const desktop = document.getElementById('desktop');
  const panels = [...desktop.querySelectorAll('[data-panel]')];
  const wide = window.matchMedia('(min-width: 941px)');
  let layer = 5;
  const defaults = () => {
    const height = name => panels.find(panel => panel.dataset.panel === name)?.offsetHeight ?? 0;
    const positions = { main: { x: 0, y: 0 }, eq: { x: 0, y: height('main') + 8 }, video: { x: 350, y: 0 }, playlist: { x: 350, y: height('video') + 8 } };
    positions.library = { x: 0, y: Math.max(positions.eq.y + height('eq'), positions.playlist.y + height('playlist')) + 12 };
    return positions;
  };
  function resizeDesktop() {
    if (!wide.matches) { desktop.style.height = ''; return; }
    desktop.style.height = `${Math.max(440, ...panels.filter(p => !p.hidden).map(p => parseFloat(p.style.getPropertyValue('--y')) + p.offsetHeight + 24))}px`;
  }
  function apply() {
    const positions = defaults();
    const limit = Math.max(950, positions.library.y + (panels.find(panel => panel.dataset.panel === 'library')?.offsetHeight ?? 0) + 24);
    for (const panel of panels) {
      const point = state.layout[panel.dataset.panel] ?? positions[panel.dataset.panel];
      panel.style.setProperty('--x', `${clamp(point.x, 0, Math.max(0, desktop.clientWidth - panel.offsetWidth))}px`);
      panel.style.setProperty('--y', `${clamp(point.y, 0, Math.max(0, limit - panel.offsetHeight))}px`);
    }
    resizeDesktop();
  }
  for (const panel of panels) {
    panel.addEventListener('pointerdown', () => { panel.style.zIndex = String(++layer); });
    const handle = panel.querySelector('.titlebar');
    let drag;
    handle.addEventListener('pointerdown', event => {
      if (!wide.matches || event.button !== 0 || event.target.closest('button')) return;
      drag = { x: event.clientX, y: event.clientY, left: parseFloat(panel.style.getPropertyValue('--x')) || 0, top: parseFloat(panel.style.getPropertyValue('--y')) || 0 };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      let x = drag.left + event.clientX - drag.x;
      let y = drag.top + event.clientY - drag.y;
      for (const other of panels.filter(p => p !== panel && !p.hidden)) {
        const ox = parseFloat(other.style.getPropertyValue('--x')) || 0;
        const oy = parseFloat(other.style.getPropertyValue('--y')) || 0;
        if (y < oy + other.offsetHeight && y + panel.offsetHeight > oy) {
          for (const target of [ox - panel.offsetWidth - 8, ox + other.offsetWidth + 8, ox]) if (Math.abs(x - target) < 9) x = target;
        }
        if (x < ox + other.offsetWidth && x + panel.offsetWidth > ox) {
          for (const target of [oy - panel.offsetHeight - 8, oy + other.offsetHeight + 8, oy]) if (Math.abs(y - target) < 9) y = target;
        }
      }
      panel.style.setProperty('--x', `${clamp(x, 0, desktop.clientWidth - panel.offsetWidth)}px`);
      const limit = Math.max(950, defaults().library.y + (panels.find(panel => panel.dataset.panel === 'library')?.offsetHeight ?? 0) + 24);
      panel.style.setProperty('--y', `${clamp(y, 0, Math.max(0, limit - panel.offsetHeight))}px`);
      resizeDesktop();
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      panel.classList.remove('dragging');
      state.layout[panel.dataset.panel] = { x: parseFloat(panel.style.getPropertyValue('--x')), y: parseFloat(panel.style.getPropertyValue('--y')) };
      persist();
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }
  window.addEventListener('resize', apply);
  new ResizeObserver(resizeDesktop).observe(desktop);
  apply();
  return { apply, refresh: apply, reset() { state.layout = {}; apply(); persist(); } };
}
