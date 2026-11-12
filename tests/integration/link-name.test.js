'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-linkname-'));
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
    const req = http.request({ hostname: '127.0.0.1', port, method, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

// Start an upload: the request the page sends per file before any data
function create(sid, password, retention = '3600') {
  const meta = { name: 'file.bin', sid, retention };
  if (password !== undefined) meta.password = password;
  return request('POST', '/files/', {
    ...TUS,
    'Upload-Length': '10',
    'Upload-Metadata': tusMeta.encode(meta),
  });
}

before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a random id needs no password', async () => {
  const res = await create('0a1b2c3d4e5f');
  assert.strictEqual(res.status, 201);
});

test('a link name without a password is rejected', async () => {
  const res = await create('nopassword');
  assert.strictEqual(res.status, 400);
  assert.match(res.body, /password/i);
});

test('a link name with an empty password is rejected', async () => {
  const res = await create('emptypassword', '');
  assert.strictEqual(res.status, 400);
  assert.match(res.body, /password/i);
});

test('a link name with a password is accepted', async () => {
  const res = await create('withpassword', 'secret');
  assert.strictEqual(res.status, 201);
});

test('a link name that is not lowercase letters and digits is rejected', async () => {
  for (const sid of ['Snimki', 'snimki-more', 'snimki more']) {
    const res = await create(sid, 'secret');
    assert.strictEqual(res.status, 400, sid);
    assert.match(res.body, /link name/i, sid);
  }
});

test('a link name that is a route of the app is rejected', async () => {
  const res = await create('admin', 'secret');
  assert.strictEqual(res.status, 400);
  assert.match(res.body, /link name/i);
});

test('more files join a named bucket with the same password', async () => {
  assert.strictEqual((await create('samepassword', 'secret')).status, 201);
  assert.strictEqual((await create('samepassword', 'secret')).status, 201);
});

test('a name in use cannot be taken with another password', async () => {
  assert.strictEqual((await create('takenname', 'secret')).status, 201);
  const res = await create('takenname', 'other');
  assert.strictEqual(res.status, 400);
  assert.match(res.body, /in use/i);
});

test('the name as spoken or typed leads to the bucket', async () => {
  assert.strictEqual((await create('snimkimore', 'secret')).status, 201);

  for (const typed of ['/Snimki-More', '/snimki-more', '/SNIMKIMORE', '/snimki%20more']) {
    const res = await request('GET', typed);
    assert.strictEqual(res.status, 302, typed);
    assert.strictEqual(res.headers.location, '/snimkimore', typed);
  }
  assert.strictEqual((await request('GET', '/snimkimore')).status, 200);
});

test('an unknown name is still not found', async () => {
  const res = await request('GET', '/Nothing-Here');
  assert.strictEqual(res.status, 404);
});

test('a name is free again once its files are gone', async () => {
  // a finished, locked upload session whose only file is a one-time download
  const created = await create('usedtwice', 'secret', 'one-time');
  assert.strictEqual(created.status, 201);
  const fid = decodeURIComponent(created.headers.location.split('/').pop());
  const sent = await request('PATCH', `/files/${ encodeURIComponent(fid) }`, {
    ...TUS,
    'Upload-Offset': '0',
    'Content-Type': 'application/offset+octet-stream',
  }, '0123456789');
  assert.strictEqual(sent.status, 204);
  assert.strictEqual((await request('PATCH', '/files/usedtwice?lock=yes', TUS)).status, 204);
  assert.match((await create('usedtwice', 'secret')).body, /Bucket locked/);

  assert.strictEqual((await request('GET', `/files/${ encodeURIComponent(fid) }`)).status, 200);
  for (let i = 0; i < 50 && (await request('GET', '/usedtwice.json')).status !== 404; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.strictEqual((await create('usedtwice', 'other')).status, 201);
});

test('a link name is refused with a retention of more than a day', async () => {
  for (const retention of ['259200', '604800']) {
    const res = await create('longretention', 'secret', retention);
    assert.strictEqual(res.status, 400, retention);
    assert.match(res.body, /one day/i, retention);
  }
});

test('a link name is accepted with one-time and up to a day', async () => {
  for (const retention of ['one-time', '3600', '86400']) {
    assert.strictEqual((await create('shortretention', 'secret', retention)).status, 201, retention);
  }
});

test('a random id keeps every retention', async () => {
  assert.strictEqual((await create('0a1b2c3d4e60', undefined, '604800')).status, 201);
});
