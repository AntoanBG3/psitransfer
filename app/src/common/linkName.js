// wizard: link names, a bucket id chosen so the link can be said aloud. The server has the
// same rules in lib/utils.js; tests/unit/link-name-page.test.js checks that they agree.

const RESERVED = ['admin', 'files', 'app', 'assets'];

// What the name field holds while typing: lowercase latin letters, digits and single hyphens
export function cleanLinkName(input) {
  return String(input)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .slice(0, 40);
}

// The bucket id of a name: hyphens only separate the words in the link
export function linkNameSid(name) {
  return name.replace(/-/g, '');
}

export function isReservedLinkName(name) {
  return RESERVED.includes(linkNameSid(name));
}

// A named link is kept for a day at most, or until its first download
const MAX_RETENTION = 86400;

export function isLinkNameRetention(retention) {
  if (retention === 'one-time') return true;
  return typeof retention === 'string' && /^\d+$/.test(retention) && +retention <= MAX_RETENTION;
}

// The retention a named link gets: the chosen one, or the longest that is allowed
export function linkNameRetention(retentions, chosen) {
  if (isLinkNameRetention(chosen)) return chosen;
  const allowed = Object.keys(retentions).filter(isLinkNameRetention);
  const timed = allowed.filter(r => r !== 'one-time').sort((a, b) => b - a);
  return timed[0] || allowed[0] || chosen;
}
