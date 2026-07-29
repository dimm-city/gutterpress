// Gutterpress preview shell controller (shared by the CLI preview and Electron).
// Every source change takes one correctness-first path: paginate a fresh hidden
// full document, then swap it in without flashing unpaginated content.
//
// TRANSPORT IS ABSTRACTED: change events arrive through connectChanges(), which
  // uses WebSocket by default but honors window.__GUTTERPRESS_CHANGE_SOURCE so an Electron
// host can feed the same full-reload signal over IPC.
(function () {
  'use strict';
  var active = document.getElementById('gutterpress-active');
  var building = null;
  if (!active) return;

  // Transparent bridge relay: forward host-toolbar commands to the active book
  // iframe and relay its replies/events back to the host.
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
  function chapterOf(el) {
    var chapter = el.closest && el.closest('[data-chapter-src]');
    return chapter ? chapter.getAttribute('data-chapter-src') : null;
  }
  function blocksInChapter(d, chapter) {
    var all = d.querySelectorAll('[data-source-line]');
    if (!chapter) return all;
    var matched = [];
    for (var i = 0; i < all.length; i++) {
      if (chapterOf(all[i]) === chapter) matched.push(all[i]);
    }
    return matched;
  }

  // data-source-line resets per source file, so preserve both chapter and line.
  function capture(f) {
    var d = fdoc(f); if (!d) return null;
    var els = d.querySelectorAll('[data-source-line]'), best = null, bestTop = -Infinity;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.bottom < 0 || r.height === 0) continue;
      if (r.top <= 80 && r.top > bestTop) { bestTop = r.top; best = els[i]; }
    }
    if (!best) {
      for (var j = 0; j < els.length; j++) {
        var rr = els[j].getBoundingClientRect();
        if (rr.bottom > 0 && rr.height > 0) { best = els[j]; break; }
      }
    }
    if (!best) return null;
    return {
      chapter: chapterOf(best),
      line: best.getAttribute('data-source-line'),
      offset: best.getBoundingClientRect().top
    };
  }

  function restore(f, anchor) {
    if (!anchor) return;
    var w = fwin(f), d = fdoc(f); if (!w || !d) return;
    var els = blocksInChapter(d, anchor.chapter);
    var wanted = parseInt(anchor.line, 10), el = null, bestDiff = Infinity;
    for (var i = 0; i < els.length; i++) {
      var line = parseInt(els[i].getAttribute('data-source-line'), 10);
      if (String(els[i].getAttribute('data-source-line')) === String(anchor.line)) {
        el = els[i];
        break;
      }
      var diff = Math.abs(line - wanted);
      if (diff < bestDiff) { bestDiff = diff; el = els[i]; }
    }
    if (el) w.scrollBy(0, el.getBoundingClientRect().top - anchor.offset);
  }

  function onReady(f, callback) {
    var w = fwin(f), d = fdoc(f); if (!w || !d) { callback(); return; }
    var hasPaged = !!d.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
    if (hasPaged) {
      var done = false;
      var finish = function () { if (!done) { done = true; callback(); } };
      w.addEventListener('renderingComplete', finish, { once: true });
      setTimeout(finish, 180000);
      return;
    }
    var attempts = 0;
    (function poll() {
      var current = fdoc(f);
      if (current && current.querySelectorAll('.pagedjs_page').length > 0) { callback(); return; }
      if (attempts++ < 800) setTimeout(poll, 25); else callback();
    })();
  }

  function swap() {
    // A newer reload invalidates any older hidden pagination. Its callback also
    // checks identity before swapping, so stale work can never win a race.
    if (building && building.parentNode) building.parentNode.removeChild(building);
    building = null;

    var frame = document.createElement('iframe');
    frame.style.visibility = 'hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = '/book.html?gutterpressshell=1&bust=' + Date.now();
    building = frame;

    var finished = false;
    function finish() {
      if (finished || building !== frame) return;
      finished = true;
      // Capture at swap time, not rebuild start: the visible frame stays usable
      // while a long book paginates and the user may scroll during that work.
      var anchor = capture(active);
      restore(frame, anchor);
      frame.style.visibility = 'visible';
      frame.removeAttribute('aria-hidden');
      var old = active;
      active = frame;
      building = null;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (old && old.parentNode) old.parentNode.removeChild(old);
        });
      });
    }

    frame.addEventListener('load', function () { onReady(frame, finish); });
    document.body.appendChild(frame);
  }

  function connectChanges(onMessage) {
    var source = window.__GUTTERPRESS_CHANGE_SOURCE;
    if (source && typeof source.subscribe === 'function') return source.subscribe(onMessage);
    var wsPath = window.__GUTTERPRESS_HMR || '/__gutterpress-hmr';
    var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + wsPath);
    ws.onmessage = function (event) {
      var message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      onMessage(message);
    };
    return function () { try { ws.close(); } catch (_) {} };
  }

  connectChanges(function (message) {
    if (!message || !message.type) return;
    // Accept legacy content-update producers, but never perform an isolated
    // chapter splice: a changed boundary can affect every following page.
    if (message.type === 'full-reload' || message.type === 'content-update') swap();
  });
})();
