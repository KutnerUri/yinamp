import test from 'node:test';
import assert from 'node:assert/strict';
import { batch } from '@preact/signals-core';
import { initialState, nextTrackIndex } from '../src/core.js';
import { createPlayerUI, savedPlayerState, bindPlayerUI } from '../src/player-ui.js';

function fixture(t) {
  const nodes = new Map();
  function node() {
    return {
      attributes: {}, classes: new Set(), writes: 0,
      setAttribute(key, value) { this.attributes[key] = value; this.writes++; },
      classList: { toggle() {} },
    };
  }
  const root = {
    body: node(), title: '',
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    },
  };
  const ids = ['K4DyBUG242c', 'J2X5mJ3HDYE'];
  const rows = ids.map(id => {
    const row = node(), select = node();
    row.classList.toggle = (name, active) => active ? row.classes.add(name) : row.classes.delete(name);
    row.querySelector = () => select;
    nodes.set(`#playlist [data-track-id="${id}"]`, row);
    return { row, select };
  });
  const state = initialState({ version: 2, playlist: ids.map((id, i) => ({ id, title: `Track ${i}` })) });
  const ui = createPlayerUI(state);
  let layouts = 0, inactive = 0;
  const dispose = bindPlayerUI(ui, { root, onLayout: () => layouts++, onInactive: () => inactive++ });
  t.after(dispose);
  return { root, state, ui, rows, ids, dispose, layouts: () => layouts, inactive: () => inactive };
}

test('volume and modes react independently, with no panel layout refresh', t => {
  const f = fixture(t), $ = selector => f.root.querySelector(selector);
  const layouts = f.layouts(), repeatWrites = $('#repeat').writes;
  const initialMuteWrites = $('#mute').writes;
  batch(() => { f.ui.volume.value = 42; f.ui.muted.value = true; });
  assert.equal($('#volume').value, 42);
  assert.equal($('#volume-value').textContent, 'MUTED');
  assert.equal($('#mute').writes, initialMuteWrites + 1, 'Related changes run one effect');
  assert.equal($('#repeat').writes, repeatWrites);
  assert.equal(f.layouts(), layouts);
  f.ui.muted.value = false;
  assert.equal($('#volume-value').textContent, '42%');
  f.ui.repeat.value = 'one';
  f.ui.shuffle.value = true;
  assert.equal($('#repeat-label').textContent, 'REPEAT 1');
  assert.equal($('#shuffle').attributes['aria-pressed'], 'true');
  assert.equal(f.layouts(), layouts);
  f.ui.visibility.eq.value = false;
  assert.equal($('#eq-panel').hidden, true);
  assert.equal(f.layouts(), layouts + 1);
  f.ui.visibility.eq.value = false;
  assert.equal(f.layouts(), layouts + 1, 'Unchanged values do not refresh layout');
});

test('selection preserves row identity and updates selection, playback controls and document title', t => {
  const f = fixture(t), $ = selector => f.root.querySelector(selector);
  assert.ok(f.rows[0].row.classes.has('current'));
  batch(() => {
    f.ui.selectedId.value = f.ids[1]; f.ui.trackTitle.value = 'Second track'; f.ui.playback.value = 'PLAYING';
  });
  assert.equal($('#playlist [data-track-id="J2X5mJ3HDYE"]'), f.rows[1].row);
  assert.equal(f.rows[0].row.classes.has('current'), false);
  assert.ok(f.rows[1].row.classes.has('current'));
  assert.equal(f.rows[0].select.attributes['aria-pressed'], 'false');
  assert.equal(f.rows[1].select.attributes['aria-pressed'], 'true');
  assert.equal($('#play').attributes['aria-pressed'], 'true');
  assert.equal(f.root.title, '▶ Second track — Yinamp');
  f.ui.trackTitle.value = 'Fetched title';
  assert.equal(f.root.title, '▶ Fetched title — Yinamp');
  f.ui.playback.value = 'PAUSED';
  assert.equal(f.inactive(), 1);
  f.ui.selectedId.value = null;
  assert.equal($('#play').disabled, true);
  assert.equal($('#next').disabled, true);
  f.dispose();
  f.ui.volume.value = 10;
  assert.equal($('#volume').value, 75, 'Disposed effects stop updating controls');
});

test('saved settings and queue navigation use current signal values', t => {
  const { state, ui, ids } = fixture(t);
  ui.selectedId.value = ids[1]; ui.volume.value = 38; ui.muted.value = true;
  ui.repeat.value = 'one'; ui.visibility.playlist.value = false;
  const saved = savedPlayerState(state, ui);
  assert.equal(nextTrackIndex(saved, { automatic: true }), 1);
  const restored = initialState(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.selectedId, ids[1]);
  assert.equal(restored.volume, 38);
  assert.equal(restored.muted, true);
  assert.equal(restored.repeat, 'one');
  assert.equal(restored.visibility.playlist, false);
  assert.equal(saved.playlist, state.playlist, 'Queue data remains explicit');
});
