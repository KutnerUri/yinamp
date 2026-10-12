import { clamp } from './core.js';

export function setupPanels(state, persist) {
  const desktop = document.getElementById('desktop');
  const panels = [...desktop.querySelectorAll('[data-panel]')];
  const wide = window.matchMedia('(min-width: 941px)');
  let layer = 5;
  const measure = () => new Map(panels.map(panel => [panel, {
    width: panel.offsetWidth, height: panel.offsetHeight,
    x: parseFloat(panel.style.getPropertyValue('--x')) || 0,
    y: parseFloat(panel.style.getPropertyValue('--y')) || 0,
  }]));
  const defaults = sizes => {
    const height = name => sizes.get(panels.find(panel => panel.dataset.panel === name))?.height ?? 0;
    const positions = { main: { x: 0, y: 0 }, eq: { x: 0, y: height('main') + 8 }, video: { x: 350, y: 0 }, playlist: { x: 350, y: height('video') + 8 } };
    positions.library = { x: 0, y: Math.max(positions.eq.y + height('eq'), positions.playlist.y + height('playlist')) + 12 };
    return positions;
  };
  function resizeDesktop(sizes = measure()) {
    if (!wide.matches) { desktop.style.height = ''; return; }
    desktop.style.height = `${Math.max(440, ...panels.filter(p => !p.hidden).map(p => sizes.get(p).y + sizes.get(p).height + 24))}px`;
  }
  function apply() {
    const sizes = measure(), width = desktop.clientWidth;
    const positions = defaults(sizes);
    const limit = Math.max(950, positions.library.y + (sizes.get(panels.find(panel => panel.dataset.panel === 'library'))?.height ?? 0) + 24);
    for (const panel of panels) {
      const point = state.layout[panel.dataset.panel] ?? positions[panel.dataset.panel];
      const size = sizes.get(panel);
      size.x = clamp(point.x, 0, Math.max(0, width - size.width));
      size.y = clamp(point.y, 0, Math.max(0, limit - size.height));
      panel.style.setProperty('--x', `${size.x}px`);
      panel.style.setProperty('--y', `${size.y}px`);
    }
    resizeDesktop(sizes);
  }
  for (const panel of panels) {
    panel.addEventListener('pointerdown', () => { panel.style.zIndex = String(++layer); });
    const handle = panel.querySelector('.titlebar');
    let drag, pointer, frame = 0;
    handle.addEventListener('pointerdown', event => {
      if (!wide.matches || event.button !== 0 || event.target.closest('button')) return;
      drag = { x: event.clientX, y: event.clientY, left: parseFloat(panel.style.getPropertyValue('--x')) || 0, top: parseFloat(panel.style.getPropertyValue('--y')) || 0 };
      handle.setPointerCapture(event.pointerId);
      panel.classList.add('dragging');
      event.preventDefault();
    });
    function move() {
      frame = 0;
      if (!drag || !pointer) return;
      const sizes = measure(), width = desktop.clientWidth, size = sizes.get(panel);
      let x = drag.left + pointer.x - drag.x;
      let y = drag.top + pointer.y - drag.y;
      for (const other of panels.filter(p => p !== panel && !p.hidden)) {
        const { x: ox, y: oy, width: ow, height: oh } = sizes.get(other);
        if (y < oy + oh && y + size.height > oy) {
          for (const target of [ox - size.width - 8, ox + ow + 8, ox]) if (Math.abs(x - target) < 9) x = target;
        }
        if (x < ox + ow && x + size.width > ox) {
          for (const target of [oy - size.height - 8, oy + oh + 8, oy]) if (Math.abs(y - target) < 9) y = target;
        }
      }
      const limit = Math.max(950, defaults(sizes).library.y + (sizes.get(panels.find(panel => panel.dataset.panel === 'library'))?.height ?? 0) + 24);
      size.x = clamp(x, 0, Math.max(0, width - size.width));
      size.y = clamp(y, 0, Math.max(0, limit - size.height));
      panel.style.setProperty('--x', `${size.x}px`);
      panel.style.setProperty('--y', `${size.y}px`);
      resizeDesktop(sizes);
      pointer = null;
    }
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      pointer = { x: event.clientX, y: event.clientY };
      if (!frame) frame = requestAnimationFrame(move);
    });
    const finish = () => {
      if (!drag) return;
      cancelAnimationFrame(frame);
      move();
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
  new ResizeObserver(() => resizeDesktop()).observe(desktop);
  apply();
  return { apply, refresh: apply, reset() { state.layout = {}; apply(); persist(); } };
}
