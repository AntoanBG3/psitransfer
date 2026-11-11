'use strict';

// wizard performance changes: versioned, long-cached assets; preloads; no delay or hashing
// for requests that carry no password; zip stores already-compressed files.

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('node:http');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-wizard-perf-'));
process.env.PSITRANSFER_UPLOAD_DIR = tmpDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const config = require('../../config');
const tusMeta = require('../../lib/tusboy/tus-metadata');
const app = require('../../lib/endpoints');
const { isCompressedName } = require('../../lib/utils');

const TUS = { 'Tus-Resumable': '1.0.0' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
let server;
let port;

function request(method, pathname, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: pathname, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

async function upload(sid, name, content, password) {
  const meta = { name, sid, retention: '3600' };
  if (password) meta.password = password;
  const created = await request('POST', '/files/', {
    ...TUS,
    'Upload-Length': String(content.length),
    'Upload-Metadata': tusMeta.encode(meta),
  });
  assert.strictEqual(created.status, 201);
  const patched = await request('PATCH', created.headers.location, {
    ...TUS,
    'Upload-Offset': '0',
    'Content-Type': 'application/offset+octet-stream',
    'Content-Length': String(content.length),
  }, content);
  assert.strictEqual(patched.status, 204);
}

async function timed(fn) {
  const t0 = performance.now();
  const res = await fn();
  return { res, ms: performance.now() - t0 };
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

test('pages link versioned assets, which are cached for a year', async () => {
  const page = await request('GET', '/');
  assert.strictEqual(page.status, 200);
  const html = page.body.toString();
  const m = html.match(/assets\/~([0-9a-f]{12})\/98\/98\.css/);
  assert.ok(m, 'stylesheet URL carries the asset version');
  const v = m[1];
  assert.match(html, new RegExp(`app/~${ v }/common\\.js`));
  assert.match(html, new RegExp(`assets/~${ v }/98/ms_sans_serif\\.woff2" rel="preload" as="font"`));
  assert.match(html, /href="lang\.json" rel="preload" as="fetch" crossorigin/);
  assert.match(html, /href="config\.json" rel="preload" as="fetch" crossorigin/);

  // the font is referenced relatively from 98.css, so it inherits the version
  for (const p of [`/assets/~${ v }/98/98.css`, `/assets/~${ v }/98/ms_sans_serif.woff2`, `/assets/~${ v }/styles.css`]) {
    const res = await request('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers['cache-control'], IMMUTABLE, p);
  }
});

test('unversioned and outdated asset URLs still work but are not cached long', async () => {
  for (const p of ['/assets/styles.css', '/assets/~000000000000/styles.css']) {
    const res = await request('GET', p);
    assert.strictEqual(res.status, 200, p);
    assert.strictEqual(res.headers['cache-control'], 'public, max-age=0', p);
  }
  const missing = await request('GET', '/assets/~000000000000/nope.css');
  assert.strictEqual(missing.status, 404);
});

test('the download page preloads its bucket list', async () => {
  await upload('preloadsid', 'a.txt', Buffer.from('a'));
  const page = await request('GET', '/preloadsid');
  assert.strictEqual(page.status, 200);
  assert.match(page.body.toString(), /href="preloadsid\.json" rel="preload" as="fetch" crossorigin/);
});

test('a protected bucket asks for its password at once, wrong passwords stay slow', async () => {
  for (let i = 0; i < 4; i++) await upload('protsid', `f${ i }.txt`, Buffer.from('x'), 'secret');

  const none = await timed(() => request('GET', '/protsid.json'));
  assert.strictEqual(none.res.status, 401);
  assert.ok(none.ms < 300, `no-password answer took ${ none.ms }ms`);

  const wrong = await timed(() => request('GET', '/protsid.json', { 'x-download-pass': 'nope' }));
  assert.strictEqual(wrong.res.status, 401);
  assert.ok(wrong.ms >= 450, `wrong-password answer took only ${ wrong.ms }ms`);

  const ok = await request('GET', '/protsid.json', { 'x-download-pass': 'secret' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(JSON.parse(ok.body).items.length, 4);
});

test('a bucket whose files have different passwords still needs the right one for each', async () => {
  await upload('mixsid', 'a.txt', Buffer.from('a'), 'one');
  await upload('mixsid', 'b.txt', Buffer.from('b'), 'two');
  assert.strictEqual((await request('GET', '/mixsid.json', { 'x-download-pass': 'one' })).status, 401);
  assert.strictEqual((await request('GET', '/mixsid.json', { 'x-download-pass': 'two' })).status, 401);
});

test('config.json without an upload password answers 401 without the brute-force delay', async (t) => {
  const prev = config.uploadPass;
  config.uploadPass = 'up';
  t.after(() => { config.uploadPass = prev; });

  const none = await timed(() => request('GET', '/config.json'));
  assert.strictEqual(none.res.status, 401);
  assert.ok(none.ms < 150, `took ${ none.ms }ms`);

  const wrong = await timed(() => request('GET', '/config.json', { 'x-passwd': 'nope' }));
  assert.strictEqual(wrong.res.status, 403);
  assert.ok(wrong.ms >= 180, `took only ${ wrong.ms }ms`);

  const ok = await request('GET', '/config.json', { 'x-passwd': 'up' });
  assert.strictEqual(ok.status, 200);
});

// compression method of every local file header in a zip: 0 = stored, 8 = deflated
function zipEntries(buf) {
  const out = {};
  for (let i = buf.indexOf('PK\x03\x04'); i !== -1; i = buf.indexOf('PK\x03\x04', i + 4)) {
    const method = buf.readUInt16LE(i + 8);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    out[buf.subarray(i + 30, i + 30 + nameLen).toString()] = method;
    i += 30 + nameLen + extraLen;
  }
  return out;
}

test('zip downloads store already-compressed files and deflate the rest', async () => {
  const text = Buffer.from('compress me '.repeat(1000));
  await upload('zipsid', 'photo.JPG', text);
  await upload('zipsid', 'notes.txt', text);
  const list = JSON.parse((await request('GET', '/zipsid.json')).body);
  const zip = await request('GET', `/files/zipsid++${ list.archiveToken }.zip`);
  assert.strictEqual(zip.status, 200);
  assert.deepStrictEqual(zipEntries(zip.body), { 'photo.JPG': 0, 'notes.txt': 8 });
  // let the download's lastDownload write finish before the temp dir goes
  await new Promise(r => setTimeout(r, 200));
});

test('tar.gz packs a mostly-media bucket without compression and compresses the rest', async () => {
  const text = Buffer.from('compress me '.repeat(10000));
  await upload('tgzmedia', 'clip.mp4', text);
  await upload('tgztext', 'notes.txt', text);
  for (const [sid, stored] of [['tgzmedia', true], ['tgztext', false]]) {
    const list = JSON.parse((await request('GET', `/${ sid }.json`)).body);
    const tgz = await request('GET', `/files/${ sid }++${ list.archiveToken }.tar.gz`);
    assert.strictEqual(tgz.status, 200);
    const tarball = require('zlib').gunzipSync(tgz.body);
    assert.ok(tarball.includes(text), `${ sid } round-trips`);
    if (stored) assert.ok(tgz.body.length > text.length, `${ sid } is stored`);
    else assert.ok(tgz.body.length < text.length / 10, `${ sid } is compressed`);
  }
  await new Promise(r => setTimeout(r, 200));
});

test('isCompressedName', () => {
  for (const n of ['a.jpg', 'b.JPEG', 'c.mp4', 'd.mov', 'e.zip', 'f.tar.gz', 'g.pdf', 'h.docx', 'i.heic', 'j.woff2']) {
    assert.ok(isCompressedName(n), n);
  }
  for (const n of ['a.txt', 'b.csv', 'c.svg', 'd.jpg.txt', 'e', 'f.ts', 'g.bmp', 'h.tar', 'i.iso', undefined]) {
    assert.ok(!isCompressedName(n), String(n));
  }
});
