const path = require('path');

// Control chars incl. NUL. Keep it strict and cross-platform.
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

function toSafeBasename(input, fallback = 'file', opts = {}) {
  const maxLength = Number.isInteger(opts.maxLength) ? opts.maxLength : 255;

  let name = '';
  if (typeof input === 'string') name = input;
  else if (input == null) name = '';
  else name = String(input);

  // Remove NUL/control chars early (these can truncate paths in some tooling).
  name = name.replace(CONTROL_CHARS_RE, '');

  // Normalize separators to POSIX then force basename (flat archives).
  name = name.replace(/\\/g, '/');
  name = path.posix.basename(name);

  // Trim to avoid whitespace-only names; keep the caller’s original if they need strict equality.
  name = name.trim();

  // Disallow dot/dotdot and empty.
  if (!name || name === '.' || name === '..') name = '';

  // Length cap.
  if (name.length > maxLength) name = name.slice(0, maxLength);

  if (!name) {
    const fb = (fallback == null ? '' : String(fallback)).replace(CONTROL_CHARS_RE, '').trim();
    return fb ? fb.slice(0, maxLength) : 'file';
  }

  return name;
}

function isSafeBasename(name, opts = {}) {
  if (typeof name !== 'string') return false;
  return toSafeBasename(name, '', opts) === name;
}

// Node randomUUID() v4 shape (case-insensitive).
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Tus resume URL id: exactly one "++", safe bucket sid, UUID key.
 */
function isSafeTusUploadId(uploadId) {
  if (typeof uploadId !== 'string' || uploadId.includes('\0')) return false;
  const parts = uploadId.split('++');
  if (parts.length !== 2) return false;
  const [sid, key] = parts;
  if (!sid || !key) return false;
  return isSafeBasename(sid) && UUID_V4_RE.test(key);
}

/**
 * Bucket-only id (lock PATCH, middleware checks without "++").
 */
function isSafeBucketFid(fid) {
  if (typeof fid !== 'string' || fid.includes('++') || fid.includes('\0')) return false;
  return isSafeBasename(fid);
}

// wizard: link names. The upload page generates 12 hex characters as bucket id; any other id
// is a name somebody chose so the link can be said aloud, which makes it guessable.
const RANDOM_SID_RE = /^[0-9a-f]{12}$/;
const LINK_NAME_RE = /^[a-z0-9]{1,64}$/;
// first path segments the app serves itself
const RESERVED_SIDS = ['admin', 'files', 'app', 'assets'];

function isRandomSid(sid) {
  return typeof sid === 'string' && RANDOM_SID_RE.test(sid);
}

/**
 * The bucket id a typed or spoken link leads to: case, hyphens, underscores and spaces
 * are not part of it.
 */
function canonicalSid(input) {
  return String(input).toLowerCase().replace(/[-_\s]+/g, '');
}

function isValidLinkName(sid) {
  return typeof sid === 'string' && LINK_NAME_RE.test(sid) && !RESERVED_SIDS.includes(sid);
}

// a named link is kept for a day at most, or until its first download
const LINK_NAME_MAX_RETENTION = 86400;

function isLinkNameRetention(retention) {
  if (retention === 'one-time') return true;
  return typeof retention === 'string' && /^\d+$/.test(retention) && +retention <= LINK_NAME_MAX_RETENTION;
}

// wizard: formats that are already compressed, stored as-is in zip downloads
const COMPRESSED_EXT_RE = new RegExp('\\.(' + [
  'jpe?g', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'jxl',
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', '3gp',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma',
  'zip', '7z', 'rar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz4', 'br', 'cab', 'jar', 'apk', 'ipa', 'aab',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'pdf', 'dmg', 'woff2?',
].join('|') + ')$', 'i');

function isCompressedName(name) {
  return typeof name === 'string' && COMPRESSED_EXT_RE.test(name);
}

module.exports = {
  isCompressedName,
  toSafeBasename,
  isSafeBasename,
  isSafeTusUploadId,
  isSafeBucketFid,
  isRandomSid,
  canonicalSid,
  isValidLinkName,
  isLinkNameRetention,
  RESERVED_SIDS,
  UUID_V4_RE,
};


