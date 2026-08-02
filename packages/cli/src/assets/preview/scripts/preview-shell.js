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
          detail.revision = hotReloadFrame.__gutterpressRevision;
          detail.updateMode = 'full-reload';
          data = { type: data.type, name: data.name, detail: detail };
          hotReloadFrame = null;
        }
        window.parent.postMessage(data, '*');
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
    if (el) w.scrollBy({
      top: el.getBoundingClientRect().top - anchor.offset,
      behavior: 'instant'
    });
  }

  // Paged.js preserves source wrappers on cloned flow fragments. Record every
  // source represented on each page so an edit can locate its live range.
  function tagPages(frame) {
    var d = fdoc(frame); if (!d) return;
    var pages = d.querySelectorAll('.pagedjs_page');
    for (var i = 0; i < pages.length; i++) {
      if (pages[i].getAttribute('data-chapter-srcs')) continue;
      var nodes = pages[i].querySelectorAll('.gutterpress-chapter[data-chapter-src]');
      var chapters = [];
      for (var j = 0; j < nodes.length; j++) {
        var chapter = nodes[j].getAttribute('data-chapter-src');
        if (chapter && chapters.indexOf(chapter) === -1) chapters.push(chapter);
      }
      if (!chapters.length) continue;
      pages[i].setAttribute('data-chapter-src', chapters[0]);
      pages[i].setAttribute('data-chapter-srcs', chapters.join('\n'));
    }
  }

  function pageChapters(page) {
    var value = page.getAttribute('data-chapter-srcs') ||
      page.getAttribute('data-chapter-src') || '';
    return value ? value.split('\n') : [];
  }

  function normId(value) {
    var result = String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    while (result.indexOf('./') === 0) result = result.slice(2);
    return result;
  }

  function liveChapterIds(d) {
    var pages = d.querySelectorAll('.pagedjs_page'), ids = [];
    for (var i = 0; i < pages.length; i++) {
      var chapters = pageChapters(pages[i]);
      for (var j = 0; j < chapters.length; j++) {
        if (ids.indexOf(chapters[j]) === -1) ids.push(chapters[j]);
      }
    }
    return ids;
  }

  function resolveChapterId(d, file) {
    var ids = liveChapterIds(d);
    if (ids.indexOf(file) !== -1) return file;
    var wanted = normId(file), matches = [];
    for (var i = 0; i < ids.length; i++) {
      if (normId(ids[i]) === wanted) matches.push(ids[i]);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function pagesFor(d, file) {
    var pages = d.querySelectorAll('.pagedjs_page');
    var owned = [], shared = [], first = -1, last = -1;
    for (var i = 0; i < pages.length; i++) {
      var chapters = pageChapters(pages[i]);
      if (chapters.indexOf(file) === -1) continue;
      if (first === -1) first = i;
      last = i;
      if (chapters.length > 1) shared.push(pages[i]);
    }
    for (i = first; i !== -1 && i <= last; i++) {
      var pageIds = pageChapters(pages[i]);
      // Blank pages generated inside a source range carry no source element.
      // Keep them with the range so an incremental replacement cannot move a
      // recto/verso blank from the middle to the end of the chapter.
      if (pageIds.indexOf(file) !== -1 || pageIds.length === 0) owned.push(pages[i]);
    }
    return { owned: owned, shared: shared };
  }

  // Remove only top-level fragments for this source. Ignoring nested matches
  // avoids removing a parent and then attempting to remove its descendants.
  function removeChapterFragments(page, file) {
    var nodes = page.querySelectorAll('.gutterpress-chapter[data-chapter-src]');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-chapter-src') !== file) continue;
      var ancestor = nodes[i].parentElement, nested = false;
      while (ancestor && ancestor !== page) {
        if (ancestor.getAttribute('data-chapter-src') === file) { nested = true; break; }
        ancestor = ancestor.parentElement;
      }
      if (!nested && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function reportIncrementalComplete(instance, revision, startedAt) {
    appliedInstance = instance;
    appliedRevision = revision;
    activeReady = true;
    reportAppliedState(appliedInstance, appliedRevision);
    if (window.parent === window) return;
    var api = fwin(active) && fwin(active).previewAPI;
    window.parent.postMessage({
      type: 'gutterpress:event',
      name: 'renderingComplete',
      detail: {
        totalPages: api && typeof api.getTotalPages === 'function' ? api.getTotalPages() : 0,
        hotReload: true,
        hotReloadMs: Math.max(0, Date.now() - startedAt),
        revision: revision,
        updateMode: 'chapter-splice'
      }
    }, '*');
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
    var hasPaged = !!d.querySelector('script[src*="paged.polyfill"]');
    if (hasPaged) {
      w.addEventListener('renderingComplete', finish);
      if (w.__PAGED_RENDERED__ === true) setTimeout(finish, 0);
      timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        if (onTimeout) onTimeout();
      }, timeoutMs || 180000);
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
      tagPages(frame);
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
        discardBuilding();
        if (window.console) console.warn('[gutterpress] replacement pagination timed out');
      });
    });
    document.body.appendChild(frame);
  }

  function spliceChapter(file, instance, revision) {
    discardBuilding();
    tagPages(active);
    var activeDocument = fdoc(active);
    var liveId = activeDocument ? resolveChapterId(activeDocument, file) : null;
    if (!liveId) {
      if (window.console) {
        console.warn('[gutterpress] chapter not found in live pages; using full reload:', file);
      }
      swap(instance, revision);
      return;
    }

    var startedAt = Date.now();
    var frame = document.createElement('iframe');
    frame.style.visibility = 'hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'updated chapter';
    frame.src = '/__chapter?file=' + encodeURIComponent(file) + '&revision=' + revision +
      '&bust=' + Date.now();
    building = frame;

    function finish() {
      if (building !== frame) return;
      frame.__gutterpressCancelReady = null;
      try {
        var ad = fdoc(active), sourceDocument = fdoc(frame);
        if (!ad || !sourceDocument) throw new Error('chapter frame is unavailable');
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
        var container = ad.querySelector('.pagedjs_pages') || ad.body;
        var found = pagesFor(ad, liveId);
        var allNewPages = Array.prototype.slice.call(
          sourceDocument.querySelectorAll('.pagedjs_page')
        );
        var firstContentPage = -1, lastContentPage = -1;
        for (var pageIndex = 0; pageIndex < allNewPages.length; pageIndex++) {
          if (!allNewPages[pageIndex].querySelector('[data-chapter-src]')) continue;
          if (firstContentPage === -1) firstContentPage = pageIndex;
          lastContentPage = pageIndex;
        }
        var newPages = firstContentPage === -1
          ? []
          : allNewPages.slice(firstContentPage, lastContentPage + 1);
        if (!found.owned.length) throw new Error('chapter is absent from the live page range');
        if (!newPages.length) throw new Error('chapter pagination produced no pages');

        var first = found.owned[0];
        var firstIsShared = found.shared.indexOf(first) !== -1;
        var firstOrder = pageChapters(first);
        var at = firstIsShared && firstOrder.indexOf(liveId) > 0
          ? first.nextElementSibling
          : first;
        var exclusive = [];
        for (var i = 0; i < found.owned.length; i++) {
          if (found.shared.indexOf(found.owned[i]) === -1) exclusive.push(found.owned[i]);
        }

        for (i = 0; i < found.shared.length; i++) {
          removeChapterFragments(found.shared[i], liveId);
          var remaining = pageChapters(found.shared[i]).filter(function (chapter) {
            return chapter !== liveId;
          });
          if (remaining.length) {
            found.shared[i].setAttribute('data-chapter-src', remaining[0]);
            found.shared[i].setAttribute('data-chapter-srcs', remaining.join('\n'));
          } else {
            found.shared[i].removeAttribute('data-chapter-src');
            found.shared[i].removeAttribute('data-chapter-srcs');
          }
        }

        for (i = 0; i < newPages.length; i++) {
          var imported = ad.importNode(newPages[i], true);
          imported.setAttribute('data-chapter-src', liveId);
          imported.setAttribute('data-chapter-srcs', liveId);
          container.insertBefore(imported, at);
        }
        for (i = 0; i < exclusive.length; i++) {
          if (exclusive[i].parentNode) exclusive[i].parentNode.removeChild(exclusive[i]);
        }

        restore(active, anchor);
        var api = fwin(active) && fwin(active).previewAPI;
        if (api && typeof api.refresh === 'function') api.refresh();
        building = null;
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        reportIncrementalComplete(instance, revision, startedAt);
      } catch (error) {
        building = null;
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (window.console) console.warn('[gutterpress] chapter splice failed; using full reload:', error);
        swap(instance, revision);
      }
    }

    frame.addEventListener('load', function () {
      if (building !== frame) return;
      var loadedDocument = fdoc(frame);
      if (!loadedDocument || (
        !loadedDocument.querySelector('script[src*="paged.polyfill"]') &&
        !loadedDocument.querySelector('.pagedjs_page')
      )) {
        discardBuilding();
        swap(instance, revision);
        return;
      }
      frame.__gutterpressCancelReady = onReady(frame, finish, function () {
        if (building !== frame) return;
        discardBuilding();
        if (window.console) console.warn('[gutterpress] chapter pagination timed out; using full reload');
        swap(instance, revision);
      }, 15000);
    });
    document.body.appendChild(frame);
  }

  function tagInitialPages() {
    onReady(active, function () {
      tagPages(active);
      activeReady = true;
      reportAppliedState(appliedInstance, appliedRevision);
    });
  }
  if (active.contentDocument && active.contentDocument.readyState === 'complete') tagInitialPages();
  active.addEventListener('load', tagInitialPages);

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
      (revision < desiredRevision || (revision === desiredRevision && building))
    ) return;
    var updateOverlaps = !!building;
    desiredInstance = instance;
    desiredRevision = revision;
    if (
      message.type === 'content-update' &&
      typeof message.file === 'string' &&
      message.file &&
      !updateOverlaps
    ) {
      spliceChapter(message.file, instance, revision);
    } else {
      swap(instance, revision);
    }
  });
  window.addEventListener('beforeunload', disconnectChanges);
})();
