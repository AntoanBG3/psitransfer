import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Upload } from 'tus-js-client';

test('a proxy body limit shrinks PATCHes while creation limits remain terminal', async t => {
  globalThis.window = {};
  globalThis.document = { location: { search: '' } };
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  const { default: store } = await import('../src/Upload/store/upload.js');
  const file = { _File: { size: 100000000 }, name: 'large.bin' };
  const state = { ...store.state, files: [file] };
  let options, retry;
  const commit = (type, payload) => {
    if (type === 'UPDATE_FILE') store.mutations.UPDATE_FILE(state, payload);
  };
  t.mock.method(Upload.prototype, 'start', function () { options = this.options; });
  t.mock.method(globalThis, 'setTimeout', fn => { retry = fn; });
  store.actions.upload({ state, commit, getters: {}, rootState: { config: {} } });
  const tooLarge = method => ({
    message: 'Payload too large',
    originalResponse: { getStatus: () => 413, getBody: () => '' },
    originalRequest: { getMethod: () => method },
  });
  assert.equal(options.chunkSize, 5000000);
  options.onChunkComplete(options.chunkSize);
  assert.equal(options.chunkSize, 50000000);
  options.onError(tooLarge('PATCH'));
  assert.equal(file.error, '');
  retry();
  assert.equal(options.chunkSize, 25000000);
  options.onChunkComplete(options.chunkSize);
  assert.equal(options.chunkSize, 25000000);
  retry = undefined;
  options.onError(tooLarge('POST'));
  assert.equal(retry, undefined);
  assert.equal(file.error, 'Payload too large');
});
