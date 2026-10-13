import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryCancelled, settleLibraryRequest } from '../electron/library-errors.mjs';

test('account changes settle interrupted IPC requests without returning catalog data', async () => {
  let reject;
  const pending = new Promise((_resolve, fail) => { reject = fail; });
  const result = settleLibraryRequest(() => pending);
  reject(libraryCancelled());
  assert.deepEqual(await result, { cancelled: true });
});

test('library IPC preserves successful data and genuine failures', async () => {
  const data = { items: [{ id: 'playlist' }] };
  assert.equal(await settleLibraryRequest(() => data), data);
  for (const error of [new Error('Network failed'), Object.assign(new Error('Sign in required'), { code: 'SIGN_IN_REQUIRED' }), new Error('The account changed. Refresh the library.')]) {
    await assert.rejects(settleLibraryRequest(() => { throw error; }), value => value === error);
  }
});
