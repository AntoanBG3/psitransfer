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
  // Vue's v-show hides the button's wrapper inline; the stylesheet hides the wrapper anyway
  function vshown(sel) { var el = $(sel); return !!el && el.parentNode.style.display !== 'none'; }
  function count(sel) { return document.querySelectorAll(sel).length; }
  function files(n) { return n === 1 ? '1 file' : n + ' files'; }

  var pages = {
    'page-upload': function () {
      if ($('.upload-uploadPassword')) return ['login', 'Enter the upload password to start.'];
      if (vshown('#uploadRetryBtn')) return ['error', 'The upload stopped. Press Retry to continue.'];
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

  // A button that sits alone in its own row is shown instead as a copy in a nearby button
  // group; the copy clicks the hidden original, so the Vue handler still does the work.
  // want(id, original, target, text): keep the copy at the start of target, or remove it.
  function want(id, original, target, text, atEnd) {
    var copy = document.getElementById(id);
    if (!original || !target) { if (copy) copy.remove(); return; }
    if (copy && copy.parentNode === target && copy._original === original) return;
    if (copy) copy.remove();
    copy = document.createElement('a');
    copy.id = id;
    copy._original = original;
    copy.className = 'btn btn-sm wizard-copy';
    copy.setAttribute('role', 'button');
    copy.tabIndex = 0;
    copy.title = original.title || '';
    var icon = original.querySelector('svg');
    if (icon) copy.appendChild(icon.cloneNode(true));
    var label = text || original.textContent.trim();
    if (label) copy.appendChild(document.createTextNode(' ' + label));
    copy.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); original.click(); });
    copy.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); original.click(); }
    });
    if (atEnd) target.appendChild(copy); else target.insertBefore(copy, target.firstChild);
  }

  function copies(state) {
    var newSession = $('.btn-new-session');
    if (page === 'page-upload') {
      want('wizard-new', state === 'uploaded' ? newSession : null, $('.upload-success-btns'));
      var add = $('.upload-files .panel-body > .text-right > .btn');
      want('wizard-add', state === 'files' ? add : null, $('.upload-files .panel-heading'), 'Add files');
      var upload = vshown('#uploadRetryBtn') ? $('#uploadRetryBtn') : vshown('#uploadBtn') ? $('#uploadBtn') : null;
      want('wizard-upload', upload, $('.col-sm-5 .panel-body'), null, true);
    } else if (page === 'page-download') {
      want('wizard-new', newSession, $('.download-app .btn-download-archive') || $('.download-app .panel-heading'));
    } else if (page === 'page-admin') {
      want('wizard-refresh', $('.btn-admin-refresh'), $('.page-admin tfoot td:first-child'), 'Refresh');
    }
  }

  var queued = false;
  function update() {
    queued = false;
    var s = pages[page]();
    copies(s[0]);
    if (body.dataset.state !== s[0]) body.dataset.state = s[0];
    if (status.textContent !== s[1]) status.textContent = s[1];
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(update); } }
  new MutationObserver(queue).observe(document.querySelector('#main-window > .window-body'),
    { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  update();
})();
