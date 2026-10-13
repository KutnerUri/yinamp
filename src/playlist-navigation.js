// Measure only after selection, queue edits, or resizing; scrolling uses cached bounds.
export function setupPlaylistNavigation(list, button) {
  let bounds = null;
  let viewportHeight = 0;
  let direction = '';
  let pending = 0;
  function update() {
    const top = list.scrollTop;
    const next = !bounds || !viewportHeight ? ''
      : bounds.bottom <= top ? 'up'
      : bounds.top >= top + viewportHeight ? 'down' : '';
    if (next === direction) return;
    direction = next;
    button.disabled = !next;
    button.dataset.visible = String(Boolean(next));
    // Keep the last edge while fading out.
    if (next) button.dataset.direction = next;
  }
  function refresh() {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const row = list.querySelector('li.current');
      viewportHeight = list.clientHeight;
      if (row && viewportHeight) {
        const listRect = list.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const top = rowRect.top - listRect.top - list.clientTop + list.scrollTop;
        bounds = { top, bottom: top + rowRect.height };
      } else bounds = null;
      update();
    });
  }
  list.addEventListener('scroll', update, { passive: true });
  button.addEventListener('click', () => {
    if (bounds && direction && !button.disabled) list.scrollTop = Math.max(0, bounds.top - (viewportHeight - (bounds.bottom - bounds.top)) / 2);
  });
  const observer = new ResizeObserver(refresh);
  observer.observe(list);
  // A representative row also catches touch-layout or font-height changes.
  let observedRow;
  return () => {
    if (observedRow) observer.unobserve(observedRow);
    observedRow = list.querySelector('li[data-track-id]');
    if (observedRow) observer.observe(observedRow);
    refresh();
  };
}
