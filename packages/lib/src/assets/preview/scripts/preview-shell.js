// print-md preview shell controller (shared by the CLI preview and the Electron
// viewer). Hosts book.html in an iframe and applies live edits without flicker:
//   - css-update     → hot-swap the stylesheet into the active book (no reload)
//   - content-update → re-paginate ONLY the edited chapter and splice it in
//   - full-reload    → double-buffer: paginate a hidden iframe, then swap
// Scroll position is preserved via a chapter-scoped source-line anchor.
//
// TRANSPORT IS ABSTRACTED: change events arrive via connectChanges(), which uses
// a WebSocket by default but honors an injected window.__PMD_CHANGE_SOURCE
// (subscribe(cb) → unsubscribe) — so an Electron-native host can feed events over
// IPC instead of HTTP/WS with no change to this controller. The shell HTML sets
// window.__PMD_HMR to the WS path.
(function () {
  'use strict';
  var active = document.getElementById('pmd-active');
  var building = null;
  if (!active) return;

  // Transparent bridge relay: forward host-toolbar commands (parent → shell) to
  // the active book iframe, and its replies/events back up. Lets the viewer drive
  // the book through the shell with no extra code (thin pass-through).
  window.addEventListener('message', function (e) {
    try {
      if (window.parent !== window && e.source === window.parent) {
        if (active && active.contentWindow) active.contentWindow.postMessage(e.data, '*');
      } else if (active && e.source === active.contentWindow && window.parent !== window) {
        window.parent.postMessage(e.data, '*');
      }
    } catch (_) {}
  });

  function fdoc(f) { try { return f.contentDocument; } catch (_) { return null; } }
  function fwin(f) { try { return f.contentWindow; } catch (_) { return null; } }

  function hotCss(p) {
    var d = fdoc(active); if (!d) return;
    var id = 'pmd-hot-' + p.replace(/[^a-z0-9]/gi, '_');
    var prev = d.getElementById(id); if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
    var l = d.createElement('link'); l.rel = 'stylesheet'; l.id = id; l.href = p + '?t=' + Date.now();
    (d.head || d.documentElement).appendChild(l);
  }

  function chapterOf(el) { var c = el.closest && el.closest('[data-chapter-src]'); return c ? c.getAttribute('data-chapter-src') : null; }

  // data-source-line resets PER FILE, so the anchor is scoped to its chapter —
  // otherwise the same line number matches an element in a different chapter and
  // restore jumps the view.
  function capture(f) {
    var d = fdoc(f); if (!d) return null;
    var els = d.querySelectorAll('[data-source-line]'), best = null, bestTop = -Infinity;
    for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); if (r.bottom < 0 || r.height === 0) continue; if (r.top <= 80 && r.top > bestTop) { bestTop = r.top; best = els[i]; } }
    if (!best) { for (var j = 0; j < els.length; j++) { var rr = els[j].getBoundingClientRect(); if (rr.bottom > 0 && rr.height > 0) { best = els[j]; break; } } }
    if (!best) return null;
    return { chapter: chapterOf(best), line: best.getAttribute('data-source-line'), offset: best.getBoundingClientRect().top };
  }

  function restore(f, a) {
    if (!a) return; var w = fwin(f), d = fdoc(f); if (!w || !d) return;
    var scope = a.chapter ? '[data-chapter-src="' + a.chapter + '"] ' : '';
    var el = d.querySelector(scope + '[data-source-line="' + a.line + '"]');
    if (!el) { // exact line gone (edited) → nearest source line WITHIN the chapter
      var els = d.querySelectorAll((a.chapter ? '[data-chapter-src="' + a.chapter + '"] ' : '') + '[data-source-line]');
      var want = parseInt(a.line, 10), best = null, bestDiff = Infinity;
      for (var i = 0; i < els.length; i++) { var ln = parseInt(els[i].getAttribute('data-source-line'), 10); var diff = Math.abs(ln - want); if (diff < bestDiff) { bestDiff = diff; best = els[i]; } }
      el = best;
    }
    if (!el) return;
    w.scrollBy(0, el.getBoundingClientRect().top - a.offset);
  }

  // Tag each rendered page with the chapter (data-chapter-src) it contains, so a
  // single edited chapter's pages can be located and replaced.
  function tagPages(f) {
    var d = fdoc(f); if (!d) return;
    var pages = d.querySelectorAll('.pagedjs_page');
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].getAttribute('data-chapter-src')) continue;
      var ch = pages[i].querySelector('.pmd-chapter[data-chapter-src]');
      if (ch) pages[i].setAttribute('data-chapter-src', ch.getAttribute('data-chapter-src'));
    }
  }

  // Run cb once the frame has paginated (renderingComplete) or, for static
  // output, once pages exist.
  function onReady(f, cb) {
    var w = fwin(f), d = fdoc(f); if (!w || !d) { cb(); return; }
    var has = !!d.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
    if (has) { var done = false; var g = function () { if (done) return; done = true; cb(); }; w.addEventListener('renderingComplete', g, { once: true }); setTimeout(g, 180000); }
    else { var t = 0; (function p() { var dd = fdoc(f); if (dd && dd.querySelectorAll('.pagedjs_page').length > 0) { cb(); return; } if (t++ < 800) setTimeout(p, 25); else cb(); })(); }
  }

  // Full-document double-buffer: paginate a hidden iframe, then swap it in.
  function swap() {
    if (building && building.parentNode) building.parentNode.removeChild(building); building = null;
    var anchor = capture(active);
    var f = document.createElement('iframe');
    f.style.visibility = 'hidden'; f.setAttribute('aria-hidden', 'true');
    f.src = '/book.html?pmdshell=1&bust=' + Date.now(); building = f;
    var finished = false;
    function finish() {
      if (finished || building !== f) return; finished = true;
      restore(f, anchor);
      f.style.visibility = 'visible'; f.removeAttribute('aria-hidden');
      var old = active; active = f; building = null; tagPages(active);
      requestAnimationFrame(function () { requestAnimationFrame(function () { if (old && old.parentNode) old.parentNode.removeChild(old); }); });
    }
    f.addEventListener('load', function () { onReady(f, finish); });
    document.body.appendChild(f);
  }

  // INCREMENTAL: re-paginate ONLY the edited chapter in a hidden iframe, then
  // replace that chapter's pages in the live view. Page numbers are a live CSS
  // counter so they re-flow automatically; the toolbar interface is refreshed
  // (Paged.js didn't re-run). Falls back to a full double-buffer swap on failure.
  function spliceChapter(file) {
    var anchor = capture(active);
    tagPages(active);
    var f = document.createElement('iframe'); f.style.visibility = 'hidden'; f.setAttribute('aria-hidden', 'true');
    f.src = '/__chapter?file=' + encodeURIComponent(file) + '&t=' + Date.now();
    f.addEventListener('load', function () {
      onReady(f, function () {
        try {
          var ad = fdoc(active), sd = fdoc(f);
          var container = ad.querySelector('.pagedjs_pages') || ad.body;
          var oldPages = [].slice.call(ad.querySelectorAll('.pagedjs_page[data-chapter-src="' + file + '"]'));
          var newPages = [].slice.call(sd.querySelectorAll('.pagedjs_page'));
          if (!oldPages.length || !newPages.length) throw new Error('no pages ' + oldPages.length + '/' + newPages.length);
          var at = oldPages[0];
          for (var i = 0; i < newPages.length; i++) {
            var imp = ad.importNode(newPages[i], true);
            imp.setAttribute('data-chapter-src', file);
            container.insertBefore(imp, at);
          }
          for (var j = 0; j < oldPages.length; j++) oldPages[j].parentNode.removeChild(oldPages[j]);
          restore(active, anchor);
          try { var api = fwin(active) && fwin(active).previewAPI; if (api && api.refresh) api.refresh(); } catch (_) {}
        } catch (err) { if (window.console) console.warn('[pmd] incremental splice failed, full swap:', err); swap(); }
        if (f.parentNode) f.parentNode.removeChild(f);
      });
    });
    document.body.appendChild(f);
  }

  function tagInitial() { onReady(active, function () { tagPages(active); }); }
  if (active.contentDocument && active.contentDocument.readyState === 'complete') tagInitial();
  active.addEventListener('load', tagInitial);

  // Transport: WS by default; honor an injected change source for Electron-native.
  function connectChanges(onMsg) {
    var src = window.__PMD_CHANGE_SOURCE;
    if (src && typeof src.subscribe === 'function') return src.subscribe(onMsg);
    var path = window.__PMD_HMR || '/__print-md-hmr';
    var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + path);
    ws.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } onMsg(m); };
    return function () { try { ws.close(); } catch (_) {} };
  }

  connectChanges(function (m) {
    if (!m || !m.type) return;
    if (m.type === 'css-update' && m.path) { hotCss(m.path); return; }
    if (m.type === 'content-update' && m.file) { spliceChapter(m.file); return; }
    if (m.type === 'full-reload') { swap(); return; }
  });
})();
