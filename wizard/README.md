# wizard

Home-server branch of [psi-4ward/psitransfer](https://github.com/psi-4ward/psitransfer).
This branch (`wizard`) is not meant to be merged upstream.

## What's different

Mostly the look and speed; the API and Vue logic are upstream's, with two fixes:

- Download passwords outside ASCII (Cyrillic, Japanese, ...) work. Browsers can't put them
  in the `x-download-pass` header, so the download page sends them base64-encoded (UTF-8)
  in `x-download-pass-b64` and the server decodes that. Stored passwords and ASCII requests
  are unchanged, so existing buckets keep working. Upstream issue #329; PR #333 encoded the
  stored password too, which would lock out existing buckets.
  Test: `tests/integration/unicode-download-password.test.js`.
- Icons spin and flip again. The webpack config drops Vue components' `<style>` blocks
  (upstream PR #315), so vue-awesome's icon CSS is restated in `styles.css`. PR #315 itself
  isn't taken because it would also bring back the Bootstrap-era component styles.

Speed (measured on wizard against the upstream build, see `tests/integration/wizard-perf.test.js`):

- Static files are served under `app/~<hash>/` and `assets/~<hash>/` (`lib/assetVersion.js`)
  with a one-year `immutable` Cache-Control, so browsers and Cloudflare stop revalidating
  them through the tunnel on every visit; a rebuild changes the hash. Upstream serves them
  `max-age=0`, which Cloudflare does not cache at all.
- The pages carry what their app would fetch first, as `PSITRANSFER_PRELOAD`: the
  translations, and on the upload page the config (or just the fact that an upload password
  is needed), on the download page the file list (or the fact that the bucket has a
  password). The apps render without requesting `lang.json`, `config.json` or `<sid>.json`.
  This replaces the `<link rel=preload as=fetch>` tags of the first speed pass, which
  WebKit does not reuse for XHR (it fetched everything twice). At 80ms per request, medians
  of five loads: upload page 386 -> 297ms first visit and 190 -> 118ms repeat in Chromium,
  904 -> 298ms and 308 -> 124ms in WebKit; download page 288 -> 284ms / 192 -> 121ms in
  Chromium, 391 -> 291ms / 200 -> 130ms in WebKit. The two fonts are still preloaded.
- Static files are answered from memory with bodies compressed once at startup (brotli 11,
  gzip 9) instead of on every request at brotli 4, and the bundles target browsers with
  ES2020 instead of IE 11 (no regenerator-runtime; the QR encoder is a separate chunk that
  loads when an upload has finished). The upload page's scripts and styles are 83.3KB ->
  62.9KB on the wire, the download page's 54.7KB -> 45.2KB, and a file takes 0.15ms
  instead of 1.2ms on the server.
- The pages send their assets as a `Link` preload header as well. With Early Hints enabled
  for the zone, Cloudflare answers a visit with them as a `103` before the page has come
  back through the tunnel.
- No brute-force delay or argon2 run for requests that carry no password: a protected
  bucket shows its password prompt in ~3ms instead of ~530ms.
- Zip downloads store photos, videos and archives instead of deflating them; tar.gz skips
  compression when most of the bucket is such files, and uses 1MB zlib chunks
  (zip 11 -> 290MB/s, tar.gz 11 -> 480MB/s, CPU for the test set 43s -> 2.6s).
- Files of 1MB and more whose extension is not on that list are judged by their bytes
  (`lib/compressible.js`): four 64KB samples are deflated at level 1, and the file is
  stored when that saves less than a tenth. On wizard (from RAM) a 256MB incompressible
  `.bin` took 25.6s as a zip and 6.8s as a tar.gz, now 0.65s and 0.5s. A sample is a few
  milliseconds of CPU plus four reads, about 50ms on a cold hard disk; zip samples each
  file just before sending it, tar.gz needs one answer up front and samples at most the 16
  largest files, stopping as soon as the rest cannot change it.
- tar.gz buckets that are compressed use gzip level 4 instead of 6: zlib by itself runs at
  76 against 45MB/s on wizard for 4% more bytes. Whole downloads of a 256MB text file varied
  too much between runs there (identical code: 3.4 to 8.3s) to put a number on the gain.
- Upload chunks grow with the measured speed, from 5MB up to 50MB, so each takes ~20s
  (5MB chunks ran at 10MB/s through Cloudflare, 50MB at 18MB/s). Cloudflare's 100s origin
  timeout covers the whole streamed chunk (a 50MB chunk at 350KB/s got a 524), so fixed
  big chunks would fail on slow uplinks; a failed chunk halves the size, and its received
  bytes are kept. The server's request timeout is an hour (LAN uploads skip Cloudflare),
  and idle connections stay open past cloudflared's 90s pool.
- A wrong download password costs one argon2 check; a right one checks the other files'
  hashes in parallel.

Tried and not kept, because they measured no gain: `stale-while-revalidate` on the upload
page (browsers do not apply it to navigations); 1MB zlib chunks and other deflate levels for
zip entries; changing the gzip level mid-stream by back-pressure (`zlib.params()` leaves the
level unchanged in Node 26).

The look:

- `public/assets/styles.css` replaces the Bootstrap 3 build with a Win98 theme that
  matches the home server's other pages. It maps the Bootstrap class names the Vue
  templates use onto [98.css](https://github.com/jdan/98.css) (MIT, vendored in
  `public/assets/98/`), so upstream template changes keep merging cleanly.
- `public/pug/` wraps each page in one window (`partials/window.pug`) with a status bar
  and a Help dialog (`partials/footer.pug`), which also carries the PsiTransfer credit.
- `public/assets/icon.svg` is the page icon.

## Image

`.github/workflows/wizard.yml` merges upstream `master` into this branch, runs the
tests and pushes `ghcr.io/antoanbg3/psitransfer:wizard` (plus an immutable
`<upstream sha>-<fork sha>` tag for rollbacks). It runs on every push, weekly on
Monday and on demand. It pushes a clean merge back to this branch when it can; the
Actions token cannot push upstream commits that touch `.github/workflows`, so then it
builds the merge anyway and leaves a warning. If the merge conflicts the run fails.
Either way, merge by hand:

```sh
git fetch upstream && git merge upstream/master && git push
```

Upstream's own workflows (CI, release) are disabled on this fork.

## License

PsiTransfer is BSD-2-Clause (see `LICENSE`); 98.css is MIT (`public/assets/98/LICENSE`).
