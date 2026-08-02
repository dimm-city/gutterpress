// Gutterpress preview shell controller (shared by the CLI preview and Electron).
// Every source change takes one correctness-first path: paginate a fresh hidden
// full document, then swap it in without flashing unpaginated content.
(function () {
  'use strict';
  var active = document.getElementById('gutterpress-active');
  var building = null;
  var hotReloadFrame = null;
  if (!active) return;

  // Transparent bridge relay: forward host-toolbar commands to the active book
  // iframe and relay its replies/events back to the host.
  window.addEventListener('message', function (e) {
    try {
      if (window.parent !== window && e.source === window.parent) {
        if (active && active.contentWindow) active.contentWindow.postMessage(e.data, '*');
      } else if (active && e.source === active.contentWindow && window.parent !== window) {
        var data = e.data;
        if (active === hotReloadFrame && data && data.type === 'gutterpress:event' && data.name === 'ready') return;
        if (active === hotReloadFrame && data && data.type === 'gutterpress:event' && data.name === 'renderingComplete') {
          var detail = {}, sourceDetail = data.detail || {};
          for (var key in sourceDetail) {
            if (Object.prototype.hasOwnProperty.call(sourceDetail, key)) detail[key] = sourceDetail[key];
          }
          detail.hotReload = true;
          var startedAt = hotReloadFrame.__gutterpressReloadStartedAt;
          detail.hotReloadMs = typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : 0;
          data = { type: data.type, name: data.name, detail: detail };
          hotReloadFrame = null;
        }
        window.parent.postMessage(data, '*');
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

  // Carry desktop canvas/debug CSS and view state into the hidden replacement
  // so its first visible paint matches the frame it replaces.
  function copyPresentation(from, to) {
    var source = fdoc(from), target = fdoc(to), targetWindow = fwin(to);
    if (!source || !target || !targetWindow) return;
    var styles = source.querySelectorAll(
      'style[data-gutterpress-desktop-canvas],style[data-gutterpress-debug]'
    );
    for (var i = 0; i < styles.length; i++) {
      (target.head || target.documentElement).appendChild(styles[i].cloneNode(true));
    }
    var api = targetWindow.previewAPI;
    var sourceBody = source.body;
    if (api && sourceBody) {
      if (sourceBody.classList.contains('view-single')) api.setViewMode('single', true);
      else if (sourceBody.classList.contains('view-spread')) api.setViewMode('spread', true);
      else if (sourceBody.classList.contains('view-two-column')) api.setViewMode('two-column', true);
      if (sourceBody.classList.contains('debug')) api.toggleDebugMode();
    }
    var zoom = source.documentElement.style.getPropertyValue('--gutterpress-zoom');
    if (api && zoom) api.setZoom(zoom, true);
  }

  function onReady(frame, callback, onTimeout) {
    var w = fwin(frame), d = fdoc(frame);
    if (!w || !d) { callback(); return function () {}; }
    var done = false, timer = null;
    function cleanup() {
      if (timer !== null) clearTimeout(timer);
      w.removeEventListener('renderingComplete', finish);
    }
    function finish() {
      if (done) return;
      done = true;
      cleanup();
      callback();
    }
    var hasPaged = !!d.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
    if (hasPaged) {
      w.addEventListener('renderingComplete', finish);
      if (w.__PAGED_RENDERED__ === true) setTimeout(finish, 0);
      timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        if (onTimeout) onTimeout();
      }, 180000);
    } else {
      var attempts = 0;
      (function poll() {
        var current = fdoc(frame);
        if (current && current.querySelectorAll('.pagedjs_page').length > 0) { finish(); return; }
        if (attempts++ < 800 && !done) timer = setTimeout(poll, 25);
        else if (!done) {
          done = true;
          cleanup();
          if (onTimeout) onTimeout();
        }
      })();
    }
    return function () { done = true; cleanup(); };
  }

  function discardBuilding() {
    if (!building) return;
    if (typeof building.__gutterpressCancelReady === 'function') {
      building.__gutterpressCancelReady();
    }
    if (building.parentNode) building.parentNode.removeChild(building);
    building = null;
  }

  function swap() {
    discardBuilding();
    var frame = document.createElement('iframe');
    frame.style.visibility = 'hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = active.title || 'preview';
    frame.__gutterpressReloadStartedAt = Date.now();
    frame.src = '/book.html?gutterpressshell=1&bust=' + Date.now();
    building = frame;

    var finished = false;
    function finish() {
      if (finished || building !== frame) return;
      finished = true;
      frame.__gutterpressCancelReady = null;
      var anchor = capture(active);
      copyPresentation(active, frame);
      restore(frame, anchor);
      var old = active;
      old.removeAttribute('id');
      frame.id = 'gutterpress-active';
      active = frame;
      hotReloadFrame = frame;
      building = null;
      var api = fwin(frame) && fwin(frame).previewAPI;
      if (api && typeof api.refresh === 'function') api.refresh();
      frame.style.visibility = 'visible';
      frame.removeAttribute('aria-hidden');
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (old && old.parentNode) old.parentNode.removeChild(old);
        });
      });
    }

    frame.addEventListener('load', function () {
      frame.__gutterpressCancelReady = onReady(frame, finish, function () {
        if (building !== frame) return;
        discardBuilding();
        if (window.console) console.warn('[gutterpress] replacement pagination timed out');
      });
    });
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
    if (message.type === 'full-reload' || message.type === 'content-update') swap();
  });
})();
