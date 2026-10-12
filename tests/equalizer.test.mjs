import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/core.js';
import { validateCommand } from '../electron/contracts.mjs';
import { normalizeEqualizer } from '../src/equalizer.js';
import { controlPage } from '../electron/page-scripts.mjs';

test('EQ survives state round trips and sanitizes corrupt saved settings', () => {
  const equalizer = { enabled: false, preamp: -3, bands: [12, -12, 1, 2, 3, 4, 5, 6, 7] };
  assert.deepEqual(initialState(initialState({ equalizer })).equalizer, equalizer);
  assert.deepEqual(normalizeEqualizer({ preamp: Infinity, bands: [NaN, 90, -90, '3'] }).bands, [0, 12, -12, 0, 0, 0, 0, 0, 0]);
  assert.equal(normalizeEqualizer({ preamp: Infinity }).preamp, 0);
});

test('EQ IPC rejects invalid gains, missing bands and nonboolean bypass', () => {
  const command = settings => ({ type: 'equalizer', settings });
  assert.doesNotThrow(() => validateCommand(command(normalizeEqualizer())));
  for (const settings of [null, { ...normalizeEqualizer(), enabled: 1 }, { ...normalizeEqualizer(), preamp: NaN }, { ...normalizeEqualizer(), bands: [0] }, { ...normalizeEqualizer(), bands: Array(9).fill(13) }]) assert.throws(() => validateCommand(command(settings)));
});

test('EQ commands update the existing audio graph without touching transport', t => {
  const previous = { document: globalThis.document, audio: globalThis.__yinampAudio };
  t.after(() => { globalThis.document = previous.document; if (previous.audio === undefined) delete globalThis.__yinampAudio; else globalThis.__yinampAudio = previous.audio; });
  globalThis.document = { querySelector: selector => selector.includes('video') ? {} : null };
  let applied;
  globalThis.__yinampAudio = { setEqualizer: value => { applied = value; } };
  const settings = normalizeEqualizer({ bands: [-12] });
  assert.deepEqual(controlPage({ type: 'equalizer', settings }), { ok: true });
  assert.equal(applied, settings);
});
