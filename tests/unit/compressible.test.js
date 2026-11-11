'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { looksCompressed, mostlyCompressed, MIN_SIZE, MAX_SAMPLED } = require('../../lib/compressible');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'psitransfer-compressible-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function file(name, data) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, data);
  return [p, data.length];
}

test('random bytes look compressed, text does not', async () => {
  assert.strictEqual(await looksCompressed(...file('random', crypto.randomBytes(3 << 20))), true);
  assert.strictEqual(await looksCompressed(...file('text', Buffer.from('some log line\n'.repeat(200000)))), false);
  assert.strictEqual(await looksCompressed(...file('zeros', Buffer.alloc(2 << 20))), false);
});

test('a compressible header does not hide a compressed body', async () => {
  // like a container format: readable metadata first, packed data after
  const data = Buffer.concat([Buffer.alloc(32 * 1024, 'header '), crypto.randomBytes(4 << 20)]);
  assert.strictEqual(await looksCompressed(...file('container', data)), true);
});

test('half text, half packed data is worth compressing', async () => {
  const data = Buffer.concat([Buffer.from('text '.repeat(500000)), crypto.randomBytes(1 << 20), Buffer.from('text '.repeat(500000))]);
  assert.strictEqual(await looksCompressed(...file('mixed', data)), false);
});

test('small and missing files are left to the compressor', async () => {
  assert.strictEqual(await looksCompressed(...file('small', crypto.randomBytes(MIN_SIZE - 1))), false);
  assert.strictEqual(await looksCompressed(path.join(dir, 'missing'), 5 << 20), false);
  assert.strictEqual(await looksCompressed(...file('nosize', crypto.randomBytes(2 << 20)).slice(0, 1), NaN), false);
});

// counts the files it is asked about; "packed" in the path means compressed
function sampler() {
  const seen = [];
  const sample = async (file) => { seen.push(file); return file.includes('packed'); };
  sample.seen = seen;
  return sample;
}
const MB = 1 << 20;

test('a bucket is judged by extension first, without sampling when that settles it', async () => {
  const sample = sampler();
  assert.strictEqual(await mostlyCompressed([
    { name: 'film.mp4', file: 'a', size: 700 * MB },
    { name: 'notes.bin', file: 'b', size: 100 * MB },
  ], sample), true);
  assert.strictEqual(await mostlyCompressed([
    { name: 'film.mp4', file: 'a', size: 100 * MB },
    { name: 'small.dat', file: 'packed', size: MIN_SIZE - 1 },
    { name: 'readme.txt', file: 'c', size: 1000 },
  ], sample), true);
  assert.deepStrictEqual(sample.seen, []);
  assert.strictEqual(await mostlyCompressed([], sample), false);
});

test('unknown files are sampled largest first, only until the answer is certain', async () => {
  // 10 packed files of 100MB and 10 text files of 10MB: six of the large ones settle it
  const files = [];
  for (let i = 0; i < 10; i++) {
    files.push({ name: `log${ i }.txt.1`, file: `text${ i }`, size: 10 * MB });
    files.push({ name: `image${ i }.raw`, file: `packed${ i }`, size: 100 * MB });
  }
  const sample = sampler();
  assert.strictEqual(await mostlyCompressed(files, sample), true);
  assert.strictEqual(sample.seen.length, 6);
  assert.ok(sample.seen.every(f => f.startsWith('packed')));

  // all text: after ten of twenty equal files the rest cannot make a majority
  const text = Array.from({ length: 20 }, (_, i) => ({ name: `dump${ i }.sql`, file: `text${ i }`, size: 50 * MB }));
  const sample2 = sampler();
  assert.strictEqual(await mostlyCompressed(text, sample2), false);
  assert.strictEqual(sample2.seen.length, 10);
});

test('sampling is capped for buckets of many files, the rest are taken to be alike', async () => {
  const raws = Array.from({ length: 500 }, (_, i) => ({ name: `shot${ i }.raw`, file: `packed${ i }`, size: 30 * MB }));
  const sample = sampler();
  assert.strictEqual(await mostlyCompressed(raws, sample), true);
  assert.strictEqual(sample.seen.length, MAX_SAMPLED);

  const dumps = Array.from({ length: 500 }, (_, i) => ({ name: `dump${ i }.sql`, file: `text${ i }`, size: 30 * MB }));
  const sample2 = sampler();
  assert.strictEqual(await mostlyCompressed(dumps, sample2), false);
  assert.strictEqual(sample2.seen.length, MAX_SAMPLED);

  // one in four packed among the sampled: not a majority
  const mixed = Array.from({ length: 400 }, (_, i) => ({ name: `part${ i }.dat`, file: i % 4 ? `text${ i }` : `packed${ i }`, size: 30 * MB }));
  assert.strictEqual(await mostlyCompressed(mixed, sampler()), false);
});
