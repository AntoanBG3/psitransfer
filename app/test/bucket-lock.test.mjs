import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Upload } from 'tus-js-client';

test('waits for the bucket lock and retries it without uploading again', async t => {
  globalThis.window = {};
  globalThis.document = { location: { search: '' } };
  const { default: store } = await import('../src/Upload/store/upload.js');
  const file = { _File: { size: 1 }, name: 'file.txt' };
  const state = { ...store.state, files: [file] };
  const states = [];
  const commit = (type, payload) => {
    if (type === 'UPDATE_FILE') store.mutations.UPDATE_FILE(state, payload);
    if (type === 'STATE') states.push(payload);
  };
  const action = () => store.actions.upload({ state, commit, getters: {}, rootState: { config: { uploadPass: 'fixture' } } });
  const started = t.mock.method(Upload.prototype, 'start', function () { this.options.onSuccess(); });
  let finish;
  const lock = t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.equal(url, state.uploadURI + '/' + state.sid + '?lock=yes');
    assert.equal(options.method, 'PATCH');
    assert.equal(options.headers['x-passwd'], 'fixture');
    return new Promise(resolve => { finish = resolve; });
  });

  action();
  assert.deepEqual(states, ['uploading']);
  finish({ ok: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.at(-1), 'uploadError');
  const retry = action();
  finish({ ok: true });
  await retry;
  assert.equal(states.at(-1), 'uploaded');
  assert.equal(started.mock.callCount(), 1);
  assert.equal(lock.mock.callCount(), 2);
});
