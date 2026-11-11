'use strict';
// wizard: versioned static URLs, so browsers and Cloudflare can cache assets for a year.
//
// The pages link /app/~<v>/... and /assets/~<v>/..., where <v> hashes every file the two
// directories serve. Relative URLs inside them (the fonts in 98.css, source maps) inherit the
// prefix, so they are versioned too. Any rebuild that changes a file changes <v>.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createHash } = require('crypto');

const IMMUTABLE = 'public, max-age=31536000, immutable';

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : [p];
  });
}

function hashDirs(dirs) {
  const h = createHash('sha256');
  for (const dir of dirs) {
    for (const file of listFiles(dir).sort()) {
      h.update(path.relative(dir, file)).update('\0').update(fs.readFileSync(file)).update('\0');
    }
  }
  return h.digest('hex').slice(0, 12);
}

/**
 * Middleware for a static mount: strips a leading /~<version> segment. The current version
 * is served as immutable; an old one (a page cached before a deploy) gets the current file
 * without long caching, so a stale URL never pins new content.
 */
function versioned(version) {
  const prefix = `/~${ version }/`;
  return (req, res, next) => {
    if (req.url.startsWith(prefix)) {
      req.url = req.url.slice(prefix.length - 1);
      res.set('Cache-Control', IMMUTABLE);
    } else if (req.url.startsWith('/~')) {
      const i = req.url.indexOf('/', 2);
      req.url = i === -1 ? '/' : req.url.slice(i);
    }
    next();
  };
}

// Files served from memory. Text is compressed once, at the highest level, instead of on
// every request at a fast one. Anything else (source maps, unknown types) is left to
// express.static.
const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
const TEXT = new Set(['.js', '.css', '.svg']);
const MIN_COMPRESS = 1024;

/**
 * Middleware for a static mount (after versioned()): answers from memory with brotli 11 or
 * gzip 9 bodies prepared at startup. The files are tiny (under 400KB in all) and never
 * change while the server runs: the asset version is computed once from the same bytes.
 * Until a file's compressed bodies are ready (about a second after startup) and for
 * files it does not hold, the request falls through to the next middleware.
 */
function inMemory(dir) {
  const files = new Map();
  const pending = [];
  for (const file of listFiles(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) continue;
    const raw = fs.readFileSync(file);
    const entry = {
      raw,
      type: TYPES[ext],
      etag: createHash('sha256').update(raw).digest('base64url').slice(0, 22),
      text: TEXT.has(ext) && raw.length >= MIN_COMPRESS,
      ready: true,
    };
    files.set('/' + path.relative(dir, file).split(path.sep).join('/'), entry);
    if (!entry.text) continue;
    entry.ready = false;
    pending.push(Promise.all([
      new Promise(resolve => zlib.brotliCompress(raw, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        },
      }, (err, buf) => resolve(err ? null : buf))),
      new Promise(resolve => zlib.gzip(raw, { level: 9 }, (err, buf) => resolve(err ? null : buf))),
    ]).then(([br, gzip]) => {
      entry.br = br;
      entry.gzip = gzip;
      entry.ready = true;
    }));
  }

  const middleware = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const entry = files.get(req.path);
    if (!entry || !entry.ready) return next();

    let body = entry.raw;
    let etag = entry.etag;
    if (entry.text) {
      res.vary('Accept-Encoding');
      const encoding = req.acceptsEncodings('br', 'gzip');
      if (encoding && entry[encoding]) {
        body = entry[encoding];
        etag += '-' + encoding;
        res.set('Content-Encoding', encoding);
      }
    }
    res.set('Content-Type', entry.type);
    res.set('ETag', `"${ etag }"`);
    // same default as express.static; versioned() has set a long one for current URLs
    if (!res.get('Cache-Control')) res.set('Cache-Control', 'public, max-age=0');
    if (req.fresh) return res.status(304).end();
    res.set('Content-Length', String(body.length));
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  // resolves when every compressed body is ready (for tests)
  middleware.ready = Promise.all(pending);
  return middleware;
}

module.exports = { hashDirs, versioned, inMemory, IMMUTABLE };
