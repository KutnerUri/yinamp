import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmUninstall } from '../electron/uninstall.mjs';

test('uninstall requires explicit confirmation; cancellation leaves the app running', async () => {
  for (const confirmed of [false, true]) {
    const exits = [];
    await confirmUninstall({ confirm: async () => confirmed, app: { exit: code => exits.push(code) } });
    assert.deepEqual(exits, confirmed ? [78] : []);
  }
});

test('a failed confirmation never uninstalls', async () => {
  let shown = false;
  await confirmUninstall({ window: {}, confirm: async () => { throw new Error('missing helper'); }, app: { exit: () => assert.fail('must not exit') }, dialog: { showMessageBox: async () => { shown = true; } } });
  assert.ok(shown);
});

test('repeated menu clicks do not open multiple confirmations', async () => {
  let close, prompts = 0;
  const options = { confirm: () => { prompts++; return new Promise(resolve => { close = resolve; }); }, app: { exit: () => assert.fail('must not exit') } };
  const first = confirmUninstall(options);
  await confirmUninstall(options);
  close(false);
  await first;
  assert.equal(prompts, 1);
});
