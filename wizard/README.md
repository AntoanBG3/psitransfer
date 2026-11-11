# wizard

Home-server branch of [psi-4ward/psitransfer](https://github.com/psi-4ward/psitransfer).
This branch (`wizard`) is not meant to be merged upstream.

## What's different

Only the look. The server, API and Vue logic are upstream's.

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
Monday and on demand. If the merge conflicts the run fails; merge by hand:

```sh
git fetch upstream && git merge upstream/master && git push
```

Upstream's own workflows (CI, release) are disabled on this fork.

## License

PsiTransfer is BSD-2-Clause (see `LICENSE`); 98.css is MIT (`public/assets/98/LICENSE`).
