export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 16000];
export function normalizeEqualizer(value) {
  const db = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(-12, Math.min(12, value)) : 0;
  return { enabled: value?.enabled !== false, preamp: db(value?.preamp), bands: EQ_FREQUENCIES.map((_, index) => db(value?.bands?.[index])) };
}

export function setupEqualizer({ root = document, state, player, persist }) {
  if (!window.yinampDesktop) return;
  let available;
  const inputs = [...root.querySelectorAll('.eq-sliders input')];
  const toolbar = root.querySelector('.eq-toolbar');
  const toggle = document.createElement('button');
  toggle.className = 'metal small-button';
  const reset = document.createElement('button');
  reset.className = 'metal small-button'; reset.textContent = 'RESET';
  toolbar.replaceChildren(toggle, reset);
  root.querySelector('.eq-sliders').setAttribute('aria-label', 'Desktop audio equalizer');
  root.querySelector('.eq-explanation').textContent = 'Lower PRE if boosted bands sound distorted.';
  function render() {
    toggle.textContent = state.equalizer.enabled ? 'ON' : 'BYPASS';
    toggle.setAttribute('aria-pressed', String(state.equalizer.enabled));
    root.querySelector('#toggle-eq').dataset.active = String(state.equalizer.enabled && available !== false);
    const preamp = state.equalizer.preamp;
    root.querySelector('#eq-preamp-value').textContent = `${preamp > 0 ? '+' : preamp < 0 ? '−' : ''}${Math.abs(preamp).toFixed(1)} dB`;
    root.querySelector('.eq-note').textContent = available === false ? 'EQ UNAVAILABLE' : available === undefined ? 'EQ READY' : state.equalizer.enabled ? 'EQ ON' : 'EQ BYPASSED';
    inputs.forEach((input, index) => {
      input.disabled = available === false; input.step = '0.5';
      const name = index ? `${EQ_FREQUENCIES[index - 1]} Hz` : 'Preamp';
      const value = index ? state.equalizer.bands[index - 1] : state.equalizer.preamp;
      input.value = value; input.setAttribute('aria-label', name);
      input.setAttribute('aria-valuetext', `${value} dB`); input.title = `${name}: ${value} dB`;
    });
    const points = state.equalizer.bands.map((db, index) => `${index * 100 / 8},${11 - (state.equalizer.enabled ? db : 0) * .75}`).join(' ');
    root.querySelector('.eq-curve').innerHTML = `<svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" /></svg>`;
  }
  function apply() { render(); player.equalizer(state.equalizer); persist(); }
  inputs.forEach((input, index) => { input.oninput = () => {
    if (index) state.equalizer.bands[index - 1] = Number(input.value);
    else state.equalizer.preamp = Number(input.value);
    apply();
  }; });
  toggle.onclick = () => { state.equalizer.enabled = !state.equalizer.enabled; apply(); };
  reset.onclick = () => { state.equalizer = normalizeEqualizer(); apply(); };
  render();
  return { setAvailable(value) { if (available !== value) { available = value; render(); } } };
}
