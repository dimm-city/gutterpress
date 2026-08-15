// Gutterpress preview shell controller (shared by the CLI preview and Electron).
// A Markdown edit paginates only that source file and replaces its live pages;
// geometry-wide changes paginate and atomically swap a fresh full document.
(function () {
  'use strict';
  var active = document.getElementById('gutterpress-active');
  var building = null;
  var hotReloadFrame = null;
  var retiring = null;
  var initialInstance = window.__GUTTERPRESS_INSTANCE;
  var initialRevision = Number(window.__GUTTERPRESS_REVISION);
  var appliedInstance = typeof initialInstance === 'string' ? initialInstance : '';
  var appliedRevision = Number.isSafeInteger(initialRevision) && initialRevision >= 0 ? initialRevision : 0;
  var desiredInstance = appliedInstance;
  var desiredRevision = appliedRevision;
  var reportAppliedState = function () {};
  var activeReady = false;
  var lastViewportChangeAt = 0;
  var pendingSwap = null;
  var pendingSwapTimer = null;
  var SCROLL_IDLE_MS = 250;
  if (!active) return;

  // Transparent bridge relay: forward host-toolbar commands to the active book
  // iframe and relay its replies/events back to the host.
  window.addEventListener('message', function (e) {
    try {
      if (window.parent !== window && e.source === window.parent) {
        if (active && active.contentWindow) active.contentWindow.postMessage(e.data, '*');
      } else if (active && e.source === active.contentWindow) {
        var data = e.data;
        if (data && data.type === 'gutterpress:event' && data.name === 'viewportChanged') {
          lastViewportChangeAt = Date.now();
          if (pendingSwap) armPendingSwap();
        }
        if (active === hotReloadFrame && data && data.type === 'gutterpress:event' && data.name === 'ready') return;
        if (active === hotReloadFrame && data && data.type === 'gutterpress:event' && data.name === 'renderingComplete') {
          var detail = {}, sourceDetail = data.detail || {};
          for (var key in sourceDetail) {
            if (Object.prototype.hasOwnProperty.call(sourceDetail, key)) detail[key] = sourceDetail[key];
          }
          detail.hotReload = true;
          var startedAt = hotReloadFrame.__gutterpressReloadStartedAt;
          detail.hotReloadMs = typeof startedAt === 'number' ? Math.max(0, Date.now() - startedAt) : 0;
          detail.revision = hotReloadFrame.__gutterpressRevision;
          detail.updateMode = 'full-reload';
          data = { type: data.type, name: data.name, detail: detail };
          hotReloadFrame = null;
        }
        if (window.parent !== window) window.parent.postMessage(data, '*');
      } else if (retiring && e.source === retiring.contentWindow && window.parent !== window) {
        var retiringData = e.data;
        if (
          retiringData &&
          (retiringData.type === 'gutterpress:reply' ||
            (retiringData.type === 'gutterpress:event' &&
              retiringData.name === 'sourceLineChanged'))
        ) window.parent.postMessage(retiringData, '*');
      }
    } catch (_) {}
  });

  function fdoc(f) { try { return f.contentDocument; } catch (_) { return null; } }
  function fwin(f) { try { return f.contentWindow; } catch (_) { return null; } }
  function capture(f) {
    var w = fwin(f);
    return w ? { x: w.scrollX, y: w.scrollY } : null;
  }

  function restore(f, anchor) {
    if (!anchor) return;
    var w = fwin(f);
    if (w) w.scrollTo({ left: anchor.x, top: anchor.y, behavior: 'instant' });
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

  function onReady(frame, callback, onTimeout, timeoutMs) {
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
    // preview-interface.js's gp:layout listener re-dispatches
    // 'renderingComplete' once the native viewer's pagination completes (see
    // preview-interface.js's onRenderingComplete()).
    w.addEventListener('renderingComplete', finish);
    if (w.__GUTTERPRESS_RENDERED__ === true) {
      setTimeout(finish, 0);
    }
    timer = setTimeout(function () {
      if (done) return;
      done = true;
      cleanup();
      if (onTimeout) onTimeout();
    }, timeoutMs || 180000);
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

  function swap(instance, revision) {
    discardBuilding();
    var frame = document.createElement('iframe');
    frame.style.visibility = 'hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = active.title || 'preview';
    frame.__gutterpressReloadStartedAt = Date.now();
    frame.__gutterpressInstance = instance;
    frame.__gutterpressRevision = revision;
    frame.src = '/book.html?gutterpressshell=1&instance=' + encodeURIComponent(instance)
      + '&revision=' + revision + '&bust=' + Date.now();
    building = frame;

    var finished = false;
    function finish() {
      if (finished || building !== frame) return;
      finished = true;
      frame.__gutterpressCancelReady = null;
      var activeApi = fwin(active) && fwin(active).previewAPI;
      var pendingSource = activeApi && typeof activeApi.flushScroll === 'function'
        ? activeApi.flushScroll(true)
        : null;
      if (pendingSource && window.parent !== window) {
        window.parent.postMessage({
          type: 'gutterpress:event',
          name: 'sourceLineChanged',
          detail: pendingSource
        }, '*');
      }
      var anchor = capture(active);
      copyPresentation(active, frame);
      restore(frame, anchor);
      var old = active;
      old.removeAttribute('id');
      frame.id = 'gutterpress-active';
      retiring = old;
      active = frame;
      hotReloadFrame = frame;
      building = null;
      var api = fwin(frame) && fwin(frame).previewAPI;
      if (api && typeof api.refresh === 'function') api.refresh();
      frame.style.visibility = 'visible';
      frame.removeAttribute('aria-hidden');
      appliedInstance = instance;
      appliedRevision = revision;
      activeReady = true;
      reportAppliedState(appliedInstance, appliedRevision);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (old && old.parentNode) old.parentNode.removeChild(old);
          if (retiring === old) retiring = null;
        });
      });
    }

    frame.addEventListener('load', function () {
      frame.__gutterpressCancelReady = onReady(frame, finish, function () {
        if (building !== frame) return;
        if (window.parent !== window) {
          window.parent.postMessage({
            type: 'gutterpress:event',
            name: 'renderingCancelled',
            detail: { hotReload: true, revision: frame.__gutterpressRevision }
          }, '*');
        }
        discardBuilding();
        if (window.console) console.warn('[gutterpress] replacement pagination timed out');
      });
    });
    document.body.appendChild(frame);
  }

  // Paginating a large replacement frame monopolizes Chromium's renderer
  // thread. Starting it in the middle of a wheel gesture makes the visible
  // preview appear to seize and then jump. Autosave has already decided WHEN
  // content is ready; this tiny gate only waits when the reader is actively
  // scrolling, then starts immediately after a short quiet period.
  function beginPendingSwap() {
    pendingSwapTimer = null;
    var next = pendingSwap;
    pendingSwap = null;
    if (!next) return;
    // Second flush at the moment the swap actually executes: keystrokes
    // typed between scheduleSwap's flush and now would otherwise die with
    // the frame (the flush's postMessage is already queued to the parent
    // before the frame is retired, so delivery survives the swap).
    try {
      var bookWin = active && active.contentWindow;
      var galley = bookWin && bookWin.GutterpressGalley;
      if (galley && galley.isEditing()) galley.saveNow();
    } catch (e) { /* teardown race — nothing to flush */ }
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'gutterpress:event',
        name: 'renderingStarted',
        detail: { hotReload: true, revision: next.revision }
      }, '*');
    }
    swap(next.instance, next.revision);
  }

  function armPendingSwap() {
    if (pendingSwapTimer !== null) clearTimeout(pendingSwapTimer);
    var delay = Math.max(0, SCROLL_IDLE_MS - (Date.now() - lastViewportChangeAt));
    if (delay === 0) beginPendingSwap();
    else pendingSwapTimer = setTimeout(beginPendingSwap, delay);
  }

  function scheduleSwap(instance, revision) {
    // Galley editing (ADR 0011): a replacement frame is coming — flush any
    // sub-debounce edits as a whole-file save proposal NOW, before the live
    // book document is retired. The postMessage event survives the swap.
    try {
      var bookWin = active && active.contentWindow;
      var galley = bookWin && bookWin.GutterpressGalley;
      if (galley && galley.isEditing()) galley.saveNow();
    } catch (e) { /* cross-origin or teardown race — nothing to flush */ }
    pendingSwap = { instance: instance, revision: revision };
    armPendingSwap();
  }

  // Incremental chapter splice used to live here (spliceChapter): it needed
  // Paged.js's `.pagedjs_page` DOM to find a chapter's live page range and
  // graft a freshly-paginated replacement into it. Paged.js has been removed
  // (native-only-migration-plan.md Phase 6). A native in-place splice was
  // also tried and removed (2026-08-08 review): grafting a fresh
  // `.gutterpress-chapter` node in and calling `Gutterpress.refresh()` is not
  // sound, because `refresh()` -> `relayout()` only re-`measure()`s the
  // EXISTING strips — it never re-runs `buildStrips()`/`explodeChildren()`.
  // So any page context the edit introduces (a new `@page`/`page:`
  // assignment inside the chapter) is silently dropped: measured 2 preview
  // pages where the same content prints 3 — a preview<->PDF divergence, the
  // worst failure this project can produce. It also bought nothing: measured
  // end-to-end (file write -> change visible, 5 samples, 34pp field guide)
  // the plain full reload (`swap`, below) is 509ms avg vs the incremental
  // splice's 998ms avg. Every content-update now goes straight to `swap()`.

  function markActiveReady() {
    onReady(active, function () {
      activeReady = true;
      reportAppliedState(appliedInstance, appliedRevision);
    });
  }
  if (active.contentDocument && active.contentDocument.readyState === 'complete') markActiveReady();
  active.addEventListener('load', markActiveReady);

  function connectChanges(onMessage) {
    var source = window.__GUTTERPRESS_CHANGE_SOURCE;
    if (source && typeof source.subscribe === 'function') {
      reportAppliedState = function (instance, revision) {
        if (typeof source.acknowledge === 'function') source.acknowledge(instance, revision);
      };
      var unsubscribe = source.subscribe(onMessage);
      return typeof unsubscribe === 'function' ? unsubscribe : function () {};
    }
    var wsPath = window.__GUTTERPRESS_HMR || '/__gutterpress-hmr';
    var ws = null;
    var reconnectTimer = null;
    var reconnectDelay = 250;
    var stopped = false;

    reportAppliedState = function (instance, revision) {
      if (!ws || ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({ type: 'reload-applied', instance: instance, revision: revision }));
      } catch (_) {}
    };

    function connect() {
      if (stopped) return;
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + wsPath);
      ws.onopen = function () {
        reconnectDelay = 250;
        if (activeReady) reportAppliedState(appliedInstance, appliedRevision);
      };
      ws.onmessage = function (event) {
        var message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        onMessage(message);
      };
      ws.onclose = function () {
        ws = null;
        if (stopped || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(function () {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
    }

    connect();
    return function () {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      try { if (ws) ws.close(); } catch (_) {}
    };
  }

  var disconnectChanges = connectChanges(function (message) {
    if (!message || (
      message.type !== 'reload-state' &&
      message.type !== 'full-reload' &&
      message.type !== 'content-update'
    )) return;
    var instance = typeof message.instance === 'string' ? message.instance : null;
    var revision = Number(message.revision);
    if (!instance || !Number.isSafeInteger(revision) || revision < 0) return;
    if (instance === appliedInstance && revision <= appliedRevision) {
      if (activeReady) reportAppliedState(appliedInstance, appliedRevision);
      return;
    }
    if (
      instance === desiredInstance &&
      (revision < desiredRevision || (revision === desiredRevision && (building || pendingSwap)))
    ) return;
    desiredInstance = instance;
    desiredRevision = revision;
    scheduleSwap(instance, revision);
  });
  window.addEventListener('beforeunload', function () {
    if (pendingSwapTimer !== null) clearTimeout(pendingSwapTimer);
    disconnectChanges();
  });
})();
