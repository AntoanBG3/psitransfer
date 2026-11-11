'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wakeStorage, FILE, MIN_INTERVAL } = require('../../lib/wakeStorage');
const Store = require('../../lib/store');
const DB = require('../../lib/db');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-wake-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const written = () => new Promise(r => setTimeout(r, 100)).then(() => fs.readFileSync(path.join(dir, FILE), 'utf8'));

test('writes its file at most once a minute', async () => {
  const t0 = Date.now();
  assert.strictEqual(wakeStorage(dir, t0), true);
  assert.strictEqual(await written(), String(t0));
  assert.strictEqual(wakeStorage(dir, t0 + MIN_INTERVAL - 1), false);
  assert.strictEqual(await written(), String(t0));
  assert.strictEqual(wakeStorage(dir, t0 + MIN_INTERVAL), true);
  assert.strictEqual(await written(), String(t0 + MIN_INTERVAL));
});

test('a missing directory is ignored', async () => {
  assert.strictEqual(wakeStorage(path.join(dir, 'nope'), Date.now() + 10 * MIN_INTERVAL), true);
  await new Promise(r => setTimeout(r, 50));
});

test('the db ignores the file when it loads the upload directory', () => {
  assert.ok(fs.existsSync(path.join(dir, FILE)));
  const db = new DB(dir, new Store(dir));
  db.init();
  assert.deepStrictEqual(db.db, {});
});
