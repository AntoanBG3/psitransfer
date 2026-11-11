'use strict';

// Pages link static files under a content-hash prefix, which is cached for a year;
// plain and outdated URLs keep working with the old short caching.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-assets-'));
process.env.PSITRANSFER_UPLOAD_DIR = tmpDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const app = require('../../lib/endpoints');

const IMMUTABLE = 'public, max-age=31536000, immutable';
let server;
let port;

function request(method, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: pathname, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('the upload page links versioned assets, which are cached for a year', async () => {
  const page = await request('GET', '/');
  assert.strictEqual(page.status, 200);
  const m = page.body.match(/assets\/~([0-9a-f]{12})\/styles\.css/);
  assert.ok(m, 'stylesheet URL carries the asset version');
  assert.match(page.body, new RegExp(`app/~${ m[1] }/common\\.js`));

  const missing = await request('GET', `/assets/~${ m[1] }/missing.css`);
  assert.strictEqual(missing.status, 404);
  assert.doesNotMatch(missing.headers['cache-control'] || '', /immutable/);

  for (const p of [`/assets/~${ m[1] }/styles.css`, `/assets/~${ m[1] }/favicon.ico`]) {
    const res = await request('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers['cache-control'], IMMUTABLE, p);
  }
});

test('plain and outdated asset URLs still work without long caching', async () => {
  for (const p of ['/assets/styles.css', '/assets/~000000000000/styles.css']) {
    const res = await request('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers['cache-control'], 'public, max-age=0', p);
  }
  assert.strictEqual((await request('GET', '/assets/~000000000000/nope.css')).status, 404);
});
