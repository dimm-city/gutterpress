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

  // Tag each rendered page with EVERY chapter (data-chapter-src) present on it,
  // so a single edited chapter's pages can be located and replaced. A page
  // usually holds one chapter (the preview injects break-before:page on
  // .pmd-chapter), but project CSS can override that — a chapter starting
  // mid-page then SHARES its first page with the previous chapter, and tagging
  // only the first chapter would make the second one unlocatable (every edit
  // would degrade to a full swap). data-chapter-src keeps the first chapter for
  // compatibility; data-chapter-srcs is the full newline-separated list.
  function tagPages(f) {
    var d = fdoc(f); if (!d) return;
    var pages = d.querySelectorAll('.pagedjs_page');
    for (var i = 0; i < pages.length; i++) {
      // Known edge: a page tagged with a single chapter by a splice keeps that
      // tag here (continue), so if a LATER reflow makes two chapters share the
      // page its data-chapter-srcs can go stale until the next full reload
      // re-tags everything. Accepted — the full reload resolves it.
      if (pages[i].getAttribute('data-chapter-srcs')) continue;
      var chs = pages[i].querySelectorAll('.pmd-chapter[data-chapter-src]');
      var list = [];
      for (var j = 0; j < chs.length; j++) {
        var v = chs[j].getAttribute('data-chapter-src');
        if (v && list.indexOf(v) === -1) list.push(v);
      }
      if (!list.length) continue;
      pages[i].setAttribute('data-chapter-src', list[0]);
      pages[i].setAttribute('data-chapter-srcs', list.join('\n'));
    }
  }

  function pageChapters(page) {
    var v = page.getAttribute('data-chapter-srcs') || page.getAttribute('data-chapter-src') || '';
    return v ? v.split('\n') : [];
  }

  // Canonical chapter id (inline copy of lib/markdown/chapter-id.ts — this
  // file is plain embedded JS and cannot import the lib): forward slashes,
  // no './' prefix, no duplicate slashes.
  function normId(s) {
    s = String(s || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    while (s.indexOf('./') === 0) s = s.slice(2);
    return s;
  }

  // Every distinct chapter id present in the live view's page tags.
  function liveChapterIds(d) {
    var pages = d.querySelectorAll('.pagedjs_page'), ids = [], i, j;
    for (i = 0; i < pages.length; i++) {
      var list = pageChapters(pages[i]);
      for (j = 0; j < list.length; j++) if (ids.indexOf(list[j]) === -1) ids.push(list[j]);
    }
    return ids;
  }

  // Resolve a broadcast chapter id to the tag string actually used in the
  // live view. Exact match first (the normal, canonical-everywhere case);
  // then normalized match, then unique-basename match — defensive layers for
  // a stale book.html tagged by an older build. Returns null when the chapter
  // genuinely isn't in the live view (new file, or layout we can't resolve).
  function resolveChapterId(d, file) {
    var ids = liveChapterIds(d), i;
    if (ids.indexOf(file) !== -1) return file;
    var want = normId(file), hits = [];
    for (i = 0; i < ids.length; i++) if (normId(ids[i]) === want) hits.push(ids[i]);
    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      var base = want.split('/').pop();
      for (i = 0; i < ids.length; i++) if (normId(ids[i]).split('/').pop() === base) hits.push(ids[i]);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  // Collect the live pages a chapter appears on: `owned` = every page that
  // contains any of it (document order); `shared` = the subset it shares with
  // another chapter (chapter starts or ends mid-page).
  function pagesFor(d, file) {
    var pages = d.querySelectorAll('.pagedjs_page');
    var owned = [], shared = [];
    for (var i = 0; i < pages.length; i++) {
      var list = pageChapters(pages[i]);
      if (list.indexOf(file) === -1) continue;
      owned.push(pages[i]);
      if (list.length > 1) shared.push(pages[i]);
    }
    return { owned: owned, shared: shared };
  }

  // Report shell-side incremental-preview degradations to the preview server's
  // log (best-effort) so bug reports carry the reason, not just the symptom.
  function logToServer(msg) {
    try { fetch('/__log', { method: 'POST', body: msg }).catch(function () {}); } catch (_) {}
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
    // Presence check BEFORE rendering: if the chapter can't be located in the
    // live view, the splice can never succeed — go straight to the full swap
    // instead of paying a wasted single-chapter render first. The log carries
    // both sides of the identity so any future mismatch is self-diagnosing.
    var ad0 = fdoc(active);
    var liveId = ad0 ? resolveChapterId(ad0, file) : null;
    if (!liveId) {
      var ids = ad0 ? liveChapterIds(ad0) : [];
      var detail = 'broadcast "' + file + '" matched no live data-chapter-src tag (new file?); live tags: [' + ids.join(', ') + ']';
      if (window.console) console.warn('[pmd] incremental splice skipped, full swap: ' + detail);
      logToServer('splice skipped (full swap) for ' + file + ': ' + detail);
      swap();
      return;
    }
    var f = document.createElement('iframe'); f.style.visibility = 'hidden'; f.setAttribute('aria-hidden', 'true');
    f.src = '/__chapter?file=' + encodeURIComponent(file) + '&t=' + Date.now();
    f.addEventListener('load', function () {
      onReady(f, function () {
        try {
          var ad = fdoc(active), sd = fdoc(f);
          var container = ad.querySelector('.pagedjs_pages') || ad.body;
          var found = pagesFor(ad, liveId);
          var newPages = [].slice.call(sd.querySelectorAll('.pagedjs_page'));
          if (!newPages.length) throw new Error('chapter render produced no pages');
          if (!found.owned.length) throw new Error('chapter not present in live view (new file?)');

          // Exclusive pages (this chapter only) are replaced wholesale; shared
          // pages only lose this chapter's fragment.
          var exclusive = [], i, j;
          for (i = 0; i < found.owned.length; i++) {
            if (found.shared.indexOf(found.owned[i]) === -1) exclusive.push(found.owned[i]);
          }
          // Insertion point derived from chapter order in the live view: before
          // the chapter's first exclusive page, or — when it starts mid-page and
          // owns no page of its own — right after the last page it shares.
          // (insertBefore(node, null) appends when the shared page is last.)
          var at = exclusive.length ? exclusive[0] : found.shared[found.shared.length - 1].nextElementSibling;

          if (found.shared.length) {
            // WHY fragments are MOVED, not re-rendered in place: a shared page's
            // flow depends on the neighbouring chapter's content, which a
            // single-chapter render cannot reproduce — re-rendering it correctly
            // would mean re-paginating the whole book (the full-swap regression
            // this path avoids). So we remove this chapter's stale fragment from
            // the shared page and give the fresh render its own pages. Content
            // is fully up to date; the one visible approximation is a gap left
            // on the shared page until the next full reload (book.html on disk
            // is already regenerated correctly). Page numbers are a live CSS
            // counter and re-flow on their own.
            logToServer('splice degraded for ' + file + ': chapter shares ' + found.shared.length +
              ' page(s) with a neighbour; spliced onto its own pages until next full reload');
            for (i = 0; i < found.shared.length; i++) {
              var frags = found.shared[i].querySelectorAll('.pmd-chapter[data-chapter-src]');
              for (j = 0; j < frags.length; j++) {
                if (frags[j].getAttribute('data-chapter-src') === liveId) frags[j].parentNode.removeChild(frags[j]);
              }
              var rest = pageChapters(found.shared[i]).filter(function (c) { return c !== liveId; });
              found.shared[i].setAttribute('data-chapter-srcs', rest.join('\n'));
              if (rest.length) found.shared[i].setAttribute('data-chapter-src', rest[0]);
              else found.shared[i].removeAttribute('data-chapter-src');
            }
          }

          for (i = 0; i < newPages.length; i++) {
            var imp = ad.importNode(newPages[i], true);
            imp.setAttribute('data-chapter-src', liveId);
            imp.setAttribute('data-chapter-srcs', liveId);
            container.insertBefore(imp, at);
          }
          for (j = 0; j < exclusive.length; j++) exclusive[j].parentNode.removeChild(exclusive[j]);
          restore(active, anchor);
          try { var api = fwin(active) && fwin(active).previewAPI; if (api && api.refresh) api.refresh(); } catch (_) {}
        } catch (err) {
          var reason = err && err.message ? err.message : String(err);
          if (window.console) console.warn('[pmd] incremental splice failed, full swap:', err);
          logToServer('splice fallback to full swap for ' + file + ': ' + reason);
          swap();
        }
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
