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
- The pages preload `lang.json`, `config.json` or the bucket list and the two fonts, so they
  load in parallel with the scripts instead of after them (upload page 578 -> 360ms first
  visit, 548 -> 227ms repeat, at 100ms per request).
- No brute-force delay or argon2 run for requests that carry no password: a protected
  bucket shows its password prompt in ~3ms instead of ~530ms.
- Zip downloads store photos, videos and archives instead of deflating them; tar.gz skips
  compression when most of the bucket is such files, and uses 1MB zlib chunks
  (zip 11 -> 290MB/s, tar.gz 11 -> 480MB/s, CPU for the test set 43s -> 2.6s).
- Upload chunks grow with the measured speed, from 5MB up to 50MB, so each takes ~20s
  (5MB chunks ran at 10MB/s through Cloudflare, 50MB at 18MB/s). Cloudflare's 100s origin
  timeout covers the whole streamed chunk (a 50MB chunk at 350KB/s got a 524), so fixed
  big chunks would fail on slow uplinks; a failed chunk halves the size, and its received
  bytes are kept. The server's request timeout is an hour (LAN uploads skip Cloudflare),
  and idle connections stay open past cloudflared's 90s pool.
- A wrong download password costs one argon2 check; a right one checks the other files'
  hashes in parallel.

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
