'use strict';
// wizard: decide from a file's bytes whether compressing it is worth the CPU.
//
// The extension list in utils.isCompressedName() misses whatever it does not know: disk
// images, encrypted archives, .bin and .dat files, videos in rarer containers. Deflating
// such a file saves nothing and caps an archive download at the speed of zlib, so large
// files with an unknown extension are sampled: four 64KB pieces spread through the file are
// deflated at the fastest level, and the file counts as already compressed when that saves
// less than a tenth. The pieces come from inside the file (at 1/8, 3/8, 5/8 and 7/8), so a
// readable header or index does not speak for the whole. A sample costs a few milliseconds
// of CPU and four reads, which on a cold hard disk are four seeks (about 50ms a file).
const fs = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');

const { isCompressedName } = require('./utils');

const deflateRaw = promisify(zlib.deflateRaw);

const SAMPLE = 64 * 1024;
// smaller files are not worth the reads: deflating one takes a few milliseconds
const MIN_SIZE = 1 << 20;
const MIN_SAVING = 0.1;

async function looksCompressed(file, size) {
  if (!(size >= MIN_SIZE)) return false;
  let fh;
  try {
    fh = await fs.promises.open(file, 'r');
    let read = 0;
    let deflated = 0;
    for (const eighth of [1, 3, 5, 7]) {
      const position = Math.floor((size - SAMPLE) * eighth / 8);
      const { bytesRead, buffer } = await fh.read(Buffer.allocUnsafe(SAMPLE), 0, SAMPLE, position);
      if (!bytesRead) continue;
      read += bytesRead;
      deflated += (await deflateRaw(buffer.subarray(0, bytesRead), { level: 1 })).length;
    }
    return read > 0 && deflated > read * (1 - MIN_SAVING);
  } catch (e) {
    // unreadable here means unreadable for the archive too, which reports it
    return false;
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// tar.gz needs one answer for the whole bucket before its first byte, so the sampling is
// bounded: at most this many files, a second or so of seeks at worst
const MAX_SAMPLED = 16;

/**
 * Are more than half of the bucket's bytes already compressed? Files are judged by
 * extension; of the rest the largest are sampled, only while their answer can still change
 * the outcome and at most MAX_SAMPLED of them. If that leaves it open (hundreds of files
 * of an unknown type), the unsampled ones are taken to be like the sampled ones.
 * @param {{name: string, file: string, size: number}[]} files
 */
async function mostlyCompressed(files, sample = looksCompressed) {
  const total = files.reduce((n, f) => n + (+f.size || 0), 0);
  let packed = 0;
  const unknown = [];
  for (const f of files) {
    if (isCompressedName(f.name)) packed += +f.size || 0;
    else if (f.size >= MIN_SIZE) unknown.push(f);
  }
  unknown.sort((a, b) => b.size - a.size);
  let open = unknown.reduce((n, f) => n + f.size, 0);
  let sampled = 0;
  let sampledPacked = 0;
  // decided either way: already more than half, or out of reach
  const decided = () => packed * 2 > total || (packed + open) * 2 <= total;
  for (const f of unknown.slice(0, MAX_SAMPLED)) {
    if (decided()) break;
    open -= f.size;
    sampled += f.size;
    if (await sample(f.file, f.size)) {
      packed += f.size;
      sampledPacked += f.size;
    }
  }
  if (!decided() && sampled) packed += open * sampledPacked / sampled;
  return packed * 2 > total;
}

module.exports = { looksCompressed, mostlyCompressed, MIN_SIZE, MAX_SAMPLED };
