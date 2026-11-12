'use strict';

// The upload page's own helpers for the link name field (an ES module, shared with no one),
// checked against what the server accepts.

const { test } = require('node:test');
const assert = require('node:assert');

const utils = require('../../lib/utils');
const {
  cleanLinkName, linkNameSid, isReservedLinkName, isLinkNameRetention, linkNameRetention,
} = require('../../app/src/common/linkName.js');

test('cleanLinkName lowercases and turns spaces and underscores into hyphens', () => {
  assert.strictEqual(cleanLinkName('Snimki More_2024'), 'snimki-more-2024');
});

test('cleanLinkName drops everything but latin letters, digits and hyphens', () => {
  assert.strictEqual(cleanLinkName('foo/bar.json?x=1'), 'foobarjsonx1');
  assert.strictEqual(cleanLinkName('снимки'), '');
});

test('cleanLinkName collapses hyphens and removes leading ones', () => {
  assert.strictEqual(cleanLinkName('--a---b'), 'a-b');
});

test('cleanLinkName keeps a trailing hyphen so the next word can be typed', () => {
  assert.strictEqual(cleanLinkName('snimki-'), 'snimki-');
});

test('cleanLinkName caps the length at 40', () => {
  assert.strictEqual(cleanLinkName('a'.repeat(50)).length, 40);
});

test('linkNameSid is the name without hyphens', () => {
  assert.strictEqual(linkNameSid('snimki-more-'), 'snimkimore');
});

test('the page and the server agree on the bucket id of a name', () => {
  for (const typed of ['Snimki More', 'dogovor-2024', 'A_b c-D', 'x']) {
    const name = cleanLinkName(typed);
    assert.strictEqual(linkNameSid(name), utils.canonicalSid(name), typed);
    assert.strictEqual(utils.isValidLinkName(linkNameSid(name)), true, typed);
  }
});

test('the page knows every name the server reserves', () => {
  for (const sid of utils.RESERVED_SIDS) {
    assert.strictEqual(isReservedLinkName(sid), true, sid);
  }
  assert.strictEqual(isReservedLinkName('ad-min'), true);
  assert.strictEqual(isReservedLinkName('snimki'), false);
});

const RETENTIONS = { 'one-time': '', '3600': '', '86400': '', '604800': '', '2419200': '' };

test('the page and the server agree on the retentions of a named link', () => {
  for (const retention of [...Object.keys(RETENTIONS), '86401', '', 'forever']) {
    assert.strictEqual(isLinkNameRetention(retention), utils.isLinkNameRetention(retention), retention);
  }
});

test('linkNameRetention keeps a choice of a day or less', () => {
  assert.strictEqual(linkNameRetention(RETENTIONS, 'one-time'), 'one-time');
  assert.strictEqual(linkNameRetention(RETENTIONS, '3600'), '3600');
});

test('linkNameRetention replaces a longer choice with the longest allowed one', () => {
  assert.strictEqual(linkNameRetention(RETENTIONS, '604800'), '86400');
  assert.strictEqual(linkNameRetention({ 'one-time': '', '3600': '', '604800': '' }, '604800'), '3600');
  assert.strictEqual(linkNameRetention({ 'one-time': '', '604800': '' }, '604800'), 'one-time');
});
