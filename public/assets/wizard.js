// wizard: Help dialog, plus a page state on <body data-state> that the stylesheet and the
// status bar follow. State is read from the DOM the Vue apps render, so their code stays upstream's.
(function () {
  var body = document.body;
  var status = document.getElementById('status');
  var help = document.getElementById('help-window');
  var helpButton = document.getElementById('help-button');

  function showHelp(open) {
    help.hidden = !open;
    body.classList.toggle('help-open', open);
    if (open) document.getElementById('help-ok').focus();
    else helpButton.focus();
  }
  helpButton.addEventListener('click', function () { showHelp(help.hidden); });
  document.getElementById('help-close').addEventListener('click', function () { showHelp(false); });
  document.getElementById('help-ok').addEventListener('click', function () { showHelp(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !help.hidden) showHelp(false); });

  function $(sel) { return document.querySelector(sel); }
  function shown(sel) { var el = $(sel); return !!el && el.getClientRects().length > 0; }
  function count(sel) { return document.querySelectorAll(sel).length; }
  function files(n) { return n === 1 ? '1 file' : n + ' files'; }

  var pages = {
    'page-upload': function () {
      if ($('.upload-uploadPassword')) return ['login', 'Enter the upload password to start.'];
      if (shown('#uploadRetryBtn')) return ['error', 'The upload stopped. Press Retry to continue.'];
      if (shown('.overall-process')) return ['uploading', 'Uploading. Keep this page open until it finishes.'];
      if (shown('.share-link')) return ['uploaded', 'Done. Copy the link, show the QR code or send it by e-mail.'];
      var n = count('.upload-files tbody tr');
      if (n) return ['files', files(n) + ' ready. Add more or press Upload.'];
      if ($('.upload-files')) return ['empty', 'Drop files anywhere on this page, or click the box to choose them.'];
      return ['loading', 'Loading...'];
    },
    'page-download': function () {
      if ($('.download-app .well input[type=password]')) return ['locked', 'This transfer is password protected.'];
      var n = count('table.files tbody tr');
      if (n) return ['list', files(n) + '. Click one to download it' + (n > 1 && $('.btn-download-archive') ? ', or get them all as zip or tar.gz.' : '.')];
      return ['loading', 'Loading...'];
    },
    'page-admin': function () {
      if ($('.download-app form.well')) return ['login', 'Enter the admin password.'];
      var n = count('tr.bucket');
      return ['list', (n === 1 ? '1 transfer' : n + ' transfers') + '. Click one to list its files.'];
    }
  };
  var page = Object.keys(pages).filter(function (c) { return body.classList.contains(c); })[0];
  if (!page) return;

  var queued = false;
  function update() {
    queued = false;
    var s = pages[page]();
    if (body.dataset.state !== s[0]) body.dataset.state = s[0];
    if (status.textContent !== s[1]) status.textContent = s[1];
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  new MutationObserver(queue).observe(document.querySelector('#main-window > .window-body'),
    { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  update();
})();
