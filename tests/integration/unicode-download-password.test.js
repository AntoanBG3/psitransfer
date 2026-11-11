'use strict';

// Download passwords outside ASCII (e.g. Cyrillic) cannot travel in a plain HTTP header,
// so the download page sends them base64-encoded in x-download-pass-b64. Stored passwords
// are unchanged; plain ASCII passwords keep using x-download-pass.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-unicode-pass-'));
process.env.PSITRANSFER_UPLOAD_DIR = tmpDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const tusMeta = require('../../lib/tusboy/tus-metadata');
const app = require('../../lib/endpoints');

const TUS = { 'Tus-Resumable': '1.0.0' };
let server;
let port;

function request(method, pathname, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: pathname, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function upload(sid, password) {
  const content = Buffer.from('hello');
  const meta = { name: 'file.txt', sid, retention: '3600', password };
  const created = await request('POST', '/files/', {
    ...TUS,
    'Upload-Length': String(content.length),
    'Upload-Metadata': tusMeta.encode(meta),
  });
  assert.strictEqual(created.status, 201);
  const fid = decodeURIComponent(created.headers?.location?.split('/').pop() ?? '');
  return fid;
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64');

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

test('a Cyrillic download password works when sent base64-encoded', async () => {
  await upload('unicodepass1', 'тайна42');
  const ok = await request('GET', '/unicodepass1.json', { 'x-download-pass-b64': b64('тайна42') });
  assert.strictEqual(ok.status, 200);
  const wrong = await request('GET', '/unicodepass1.json', { 'x-download-pass-b64': b64('тайна43') });
  assert.strictEqual(wrong.status, 401);
});

test('an ASCII download password still works in the plain header', async () => {
  await upload('asciipass1', 'secret');
  const ok = await request('GET', '/asciipass1.json', { 'x-download-pass': 'secret' });
  assert.strictEqual(ok.status, 200);
  const viaB64 = await request('GET', '/asciipass1.json', { 'x-download-pass-b64': b64('secret') });
  assert.strictEqual(viaB64.status, 200);
  const none = await request('GET', '/asciipass1.json');
  assert.strictEqual(none.status, 401);
});
