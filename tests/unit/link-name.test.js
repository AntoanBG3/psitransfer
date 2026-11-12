'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const utils = require('../../lib/utils');

test('isRandomSid accepts the 12 hex characters the upload page generates', () => {
  assert.strictEqual(utils.isRandomSid('3fa9c1e07b2d'), true);
});

test('isRandomSid rejects anything else', () => {
  for (const sid of ['snimkimore', '3fa9c1e07b2', '3fa9c1e07b2d0', '3FA9C1E07B2D', '', null]) {
    assert.strictEqual(utils.isRandomSid(sid), false, String(sid));
  }
});

test('canonicalSid ignores case, hyphens, underscores and spaces', () => {
  assert.strictEqual(utils.canonicalSid('Snimki-More'), 'snimkimore');
  assert.strictEqual(utils.canonicalSid('snimki more_2024'), 'snimkimore2024');
  assert.strictEqual(utils.canonicalSid('3fa9c1e07b2d'), '3fa9c1e07b2d');
});

test('isValidLinkName accepts lowercase letters and digits', () => {
  assert.strictEqual(utils.isValidLinkName('snimkimore2024'), true);
});

test('isValidLinkName rejects names that are not in canonical form', () => {
  for (const sid of ['snimki-more', 'Snimki', 'snimki more', 'снимки', 'a.json', '', 'a'.repeat(65)]) {
    assert.strictEqual(utils.isValidLinkName(sid), false, sid);
  }
});

test('isValidLinkName rejects names that are routes of the app', () => {
  for (const sid of ['admin', 'files', 'app', 'assets']) {
    assert.strictEqual(utils.isValidLinkName(sid), false, sid);
  }
});

test('isLinkNameRetention allows one-time and up to a day', () => {
  for (const retention of ['one-time', '3600', '86400']) {
    assert.strictEqual(utils.isLinkNameRetention(retention), true, retention);
  }
  for (const retention of ['86401', '604800', '', 'forever', undefined]) {
    assert.strictEqual(utils.isLinkNameRetention(retention), false, String(retention));
  }
});
