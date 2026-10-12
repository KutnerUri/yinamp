import { signal, computed, effect } from '@preact/signals-core';

// Scalar UI state is reactive; queue edits, player commands and saves stay explicit.
export function createPlayerUI(state) {
  return {
    volume: signal(state.volume), muted: signal(state.muted),
    shuffle: signal(state.shuffle), repeat: signal(state.repeat),
    selectedId: signal(state.selectedId), playback: signal('CONNECTING'),
    trackTitle: signal(''),
    visibility: { eq: signal(state.visibility.eq), playlist: signal(state.visibility.playlist) },
  };
}

export function savedPlayerState(state, ui) {
  return {
    ...state,
    volume: ui.volume.value, muted: ui.muted.value,
    shuffle: ui.shuffle.value, repeat: ui.repeat.value, selectedId: ui.selectedId.value,
    visibility: { eq: ui.visibility.eq.value, playlist: ui.visibility.playlist.value },
  };
}

export function bindPlayerUI(ui, { root = document, onLayout, onInactive }) {
  const $ = selector => root.querySelector(selector);
  const volumeLabel = computed(() => ui.muted.value ? 'MUTED' : `${Math.round(ui.volume.value)}%`);
  const disposers = [
    effect(() => {
      $('#mute').setAttribute('aria-pressed', String(ui.muted.value));
      $('#volume').value = ui.volume.value;
      $('#volume-value').textContent = volumeLabel.value;
    }),
    effect(() => $('#shuffle').setAttribute('aria-pressed', String(ui.shuffle.value))),
    effect(() => {
      const repeat = ui.repeat.value;
      $('#repeat').setAttribute('aria-pressed', String(repeat !== 'off'));
      $('#repeat').setAttribute('aria-label', `Repeat ${repeat}`);
      $('#repeat-label').textContent = repeat === 'one' ? 'REPEAT 1' : 'REPEAT';
    }),
    effect(() => {
      for (const key of ['eq', 'playlist']) {
        const visible = ui.visibility[key].value;
        $(`#${key}-panel`).hidden = !visible;
        $(`#toggle-${key}`).setAttribute('aria-pressed', String(visible));
      }
      onLayout();
    }),
    effect(() => {
      const playback = ui.playback.value;
      $('#playback-state').textContent = playback;
      $('#play-indicator').textContent = playback === 'PLAYING' ? '▶' : playback === 'PAUSED' ? 'Ⅱ' : '■';
      root.body.classList.toggle('is-playing', playback === 'PLAYING');
      $('#play').setAttribute('aria-pressed', String(playback === 'PLAYING'));
      $('#pause').setAttribute('aria-pressed', String(playback === 'PAUSED'));
      if (['EMPTY', 'STOPPED', 'PAUSED', 'UNAVAILABLE'].includes(playback)) onInactive();
    }),
    effect(() => {
      const empty = !ui.selectedId.value;
      for (const id of ['play', 'pause', 'stop', 'previous', 'next']) $(`#${id}`).disabled = empty;
    }),
    effect(() => {
      root.title = ui.playback.value === 'PLAYING' && ui.selectedId.value
        ? `▶ ${ui.trackTitle.value} — Yinamp` : 'Yinamp — Back to the desktop.';
    }),
  ];
  let previousId = null;
  disposers.push(effect(() => {
    const selectedId = ui.selectedId.value;
    for (const id of new Set([previousId, selectedId])) {
      if (!id) continue;
      const row = $(`#playlist [data-track-id="${id}"]`);
      if (!row) continue;
      row.classList.toggle('current', id === selectedId);
      row.querySelector('.track-select').setAttribute('aria-pressed', String(id === selectedId));
    }
    previousId = selectedId;
  }));
  return () => disposers.forEach(dispose => dispose());
}
