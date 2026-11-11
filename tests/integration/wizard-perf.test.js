'use strict';

// wizard performance changes: versioned, long-cached assets served from memory; page data
// inlined into the pages; no delay or hashing for requests that carry no password; zip
// stores already-compressed files.

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

async function upload(sid, name, content, password, extra = {}) {
  const meta = { name, sid, retention: '3600', ...extra };
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

// the JSON a page assigns to PSITRANSFER_PRELOAD
function preloadOf(html) {
  const m = html.match(/<script>PSITRANSFER_PRELOAD = (.*);<\/script>/);
  assert.ok(m, 'page carries PSITRANSFER_PRELOAD');
  return JSON.parse(m[1]);
}

test('static files come from memory with brotli 11, gzip or plain bodies', async () => {
  await app.staticReady;
  const css = fs.readFileSync(path.join(__dirname, '../../public/assets/styles.css'));
  const zlib = require('zlib');

  const br = await request('GET', '/assets/styles.css', { 'Accept-Encoding': 'gzip, deflate, br, zstd' });
  assert.strictEqual(br.headers['content-encoding'], 'br');
  assert.strictEqual(br.headers['content-type'], 'text/css; charset=utf-8');
  assert.strictEqual(br.headers['vary'], 'Accept-Encoding');
  assert.ok(zlib.brotliDecompressSync(br.body).equals(css));
  // the compression middleware's brotli 4 is what it replaces
  const quick = zlib.brotliCompressSync(css, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } });
  assert.ok(br.body.length < quick.length * 0.9, `${ br.body.length } vs ${ quick.length } bytes`);

  const gz = await request('GET', '/assets/styles.css', { 'Accept-Encoding': 'gzip' });
  assert.strictEqual(gz.headers['content-encoding'], 'gzip');
  assert.ok(zlib.gunzipSync(gz.body).equals(css));
  assert.notStrictEqual(gz.headers.etag, br.headers.etag);

  const plain = await request('GET', '/assets/styles.css', { 'Accept-Encoding': 'identity' });
  assert.strictEqual(plain.headers['content-encoding'], undefined);
  assert.ok(plain.body.equals(css));

  const cached = await request('GET', '/assets/styles.css', { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag });
  assert.strictEqual(cached.status, 304);
  assert.strictEqual(cached.body.length, 0);

  const head = await request('HEAD', '/assets/styles.css', { 'Accept-Encoding': 'br' });
  assert.strictEqual(head.headers['content-length'], String(br.body.length));
  assert.strictEqual(head.body.length, 0);

  // binary files are not compressed
  const font = await request('GET', '/assets/98/ms_sans_serif.woff2', { 'Accept-Encoding': 'br' });
  assert.strictEqual(font.status, 200);
  assert.strictEqual(font.headers['content-type'], 'font/woff2');
  assert.strictEqual(font.headers['content-encoding'], undefined);
  assert.ok(font.body.equals(fs.readFileSync(path.join(__dirname, '../../public/assets/98/ms_sans_serif.woff2'))));

  // files it does not hold fall through to express.static
  const license = await request('GET', '/assets/98/LICENSE');
  assert.strictEqual(license.status, 200);
  assert.strictEqual((await request('GET', '/assets/..%2f..%2fconfig.js')).status, 404);
});

test('the upload page carries translations and config, and is revalidated in the background', async (t) => {
  const page = await request('GET', '/', { 'Accept-Language': 'de' });
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers['cache-control'], 'private, max-age=0, stale-while-revalidate=604800');
  assert.match(page.headers.vary, /Accept-Language/);
  const html = page.body.toString();
  const preload = preloadOf(html);
  assert.strictEqual(preload.lang.langCode, 'de');
  assert.deepStrictEqual(preload.config, JSON.parse((await request('GET', '/config.json')).body));
  assert.strictEqual(preload.uploadPassRequired, undefined);
  assert.doesNotMatch(html, /rel="preload" as="fetch"/);

  // the same assets as a Link header, for 103 Early Hints
  const v = html.match(/assets\/~([0-9a-f]{12})\//)[1];
  const links = page.headers.link.split(', ');
  assert.strictEqual(links.length, 7);
  for (const link of links) {
    const [, url] = link.match(/^<(\/[^>]+)>; rel=preload; as=(style|font|script)/) || [];
    assert.ok(url && url.includes(`/~${ v }/`), link);
    assert.ok(html.includes(url.slice(1)), `${ url } is used by the page`);
  }

  // unchanged page: the background revalidation gets a 304
  const again = await request('GET', '/', { 'Accept-Language': 'de', 'If-None-Match': page.headers.etag });
  assert.strictEqual(again.status, 304);

  // with an upload password the config stays behind it
  const prev = config.uploadPass;
  config.uploadPass = 'up';
  t.after(() => { config.uploadPass = prev; });
  const locked = preloadOf((await request('GET', '/')).body.toString());
  assert.strictEqual(locked.uploadPassRequired, true);
  assert.strictEqual(locked.config, undefined);
  assert.ok(locked.lang.upload);
});

test('the download page carries its file list, unless the bucket has a password', async () => {
  const comment = '</script><script>alert(1)</script>\u2028';
  await upload('preloadsid', 'a.txt', Buffer.from('a'), null, { comment });
  const page = await request('GET', '/preloadsid');
  assert.strictEqual(page.status, 200);
  assert.match(page.headers['cache-control'], /no-store/);
  assert.match(page.headers.link, /\/download\.js>; rel=preload; as=script$/);
  const html = page.body.toString();
  // a comment cannot close the script element
  assert.strictEqual(html.match(/<\/script>/g).length, html.match(/<script/g).length);
  const preload = preloadOf(html);
  assert.ok(preload.lang.files);
  assert.deepStrictEqual(preload.bucket, JSON.parse((await request('GET', '/preloadsid.json')).body));
  assert.strictEqual(preload.bucket.items[0].metadata.comment, comment);
  assert.ok(!html.includes('\u2028'));

  await upload('preloadprot', 'a.txt', Buffer.from('a'), 'secret');
  const prot = preloadOf((await request('GET', '/preloadprot')).body.toString());
  assert.strictEqual(prot.needsPassword, true);
  assert.strictEqual(prot.bucket, undefined);
  assert.doesNotMatch(JSON.stringify(prot), /a\.txt|argon2/);
});

test('a protected bucket asks for its password at once, wrong passwords stay slow', async () => {
  for (let i = 0; i < 4; i++) await upload('protsid', `f${ i }.txt`, Buffer.from('x'), 'secret');

  const none = await timed(() => request('GET', '/protsid.json'));
  assert.strictEqual(none.res.status, 401);

  const wrong = await timed(() => request('GET', '/protsid.json', { 'x-download-pass': 'nope' }));
  assert.strictEqual(wrong.res.status, 401);
  // the delay is a fixed 500ms timer; compare instead of using absolute bounds (shared CI runners)
  assert.ok(wrong.ms >= 490, `wrong-password answer took only ${ wrong.ms }ms`);
  assert.ok(none.ms < wrong.ms / 2, `no-password ${ none.ms }ms vs wrong-password ${ wrong.ms }ms`);

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

  const wrong = await timed(() => request('GET', '/config.json', { 'x-passwd': 'nope' }));
  assert.strictEqual(wrong.res.status, 403);
  assert.ok(wrong.ms >= 190, `wrong password took only ${ wrong.ms }ms`);
  assert.ok(none.ms < wrong.ms / 2, `no password ${ none.ms }ms vs wrong password ${ wrong.ms }ms`);

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
