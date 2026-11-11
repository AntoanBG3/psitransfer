'use strict';
// wizard: spin the storage disk up before it is needed.
//
// The upload directory is on a hard disk that sleeps when idle, and waking it takes about
// ten seconds, which the first upload request or download of a visit would spend waiting.
// Listing a bucket and checking passwords only needs the in-memory db, so the pages come
// up at once; this starts the disk at that moment, while the visitor is still reading the
// page or picking files. A read could be answered from the page cache, so it is a tiny
// write followed by fsync, which has to reach the platters.
const fs = require('fs');
const path = require('path');

const FILE = '.wake';
const MIN_INTERVAL = 60 * 1000;

let last = 0;

function wakeStorage(dir, now = Date.now()) {
  if (now - last < MIN_INTERVAL) return false;
  last = now;
  fs.open(path.join(dir, FILE), 'w', (err, fd) => {
    if (err) return;
    fs.write(fd, String(now), () => fs.fsync(fd, () => fs.close(fd, () => {})));
  });
  return true;
}

module.exports = { wakeStorage, FILE, MIN_INTERVAL };
