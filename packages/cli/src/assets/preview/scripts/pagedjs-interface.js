// Interface adapter: exposes window.previewAPI for the parent toolbar.
// Paged.js paginates into .pagedjs_page elements. We use PagedConfig.after
// to know when rendering is done.

(function () {
  'use strict';

  var pages = [];
  var currentPage = 1;
  var debugMode = false;
  var currentViewMode = 'two-column';
  var ignoreScrollUntil = 0;
  var lastSourceLine = -1;
  var lastSourceChapter = null;

  function refreshPages() {
    pages = Array.from(document.querySelectorAll('.pagedjs_page'));
    return pages;
  }

  function clampPage(n) {
    if (pages.length === 0) return 1;
    var page = Number(n);
    if (!Number.isFinite(page)) page = 1;
    return Math.max(1, Math.min(Math.round(page), pages.length));
  }

  function detectVisiblePage() {
    if (pages.length === 0) return 1;
    // Use getBoundingClientRect (viewport-relative, post-zoom) rather than
    // offsetTop. The desktop applies CSS `zoom` for fit-width; under `zoom`,
    // offsetTop stays in PRE-zoom layout coords while window.scrollY is POST-zoom,
    // so mixing them pinned the detected page to 1. getBoundingClientRect is
    // consistent with the rendered viewport at any zoom.
    var line = window.innerHeight / 3; // reference line in the upper third
    var vh = window.innerHeight;
    var last = 0;
    for (var i = 0; i < pages.length; i++) {
      var top = pages[i].getBoundingClientRect().top;
      if (top <= line) last = i;       // last page whose top is at/above the line
      else if (top > vh) break;        // well below the viewport — stop scanning
    }
    // In spread/two-column view a row holds two pages at the same top; report the
    // FIRST page of that row (matches single view, where each row is one page).
    var rowTop = pages[last].getBoundingClientRect().top;
    while (last > 0 && Math.abs(pages[last - 1].getBoundingClientRect().top - rowTop) < 2) last--;
    return last + 1;
  }

  function scrollToCurrentPage() {
    if (pages.length === 0) return;
    var page = clampPage(currentPage);
    currentPage = page;
    ignoreScrollUntil = Date.now() + 300;
    pages[page - 1].scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
    recordVisibleSource();
  }

  function pageStep(mode) {
    return (mode || currentViewMode) === 'single' ? 1 : 2;
  }

  // ── Source-mapping helpers (ADR 0005) ──────────────────────────────────────
  // Every block element carries data-source-line (markdown-it-source-map). These
  // map rendered DOM <-> markdown source line and rendered DOM <-> paged.js page,
  // which is the same-origin info the cross-iframe host cannot compute itself.
  function lineOf(el) {
    if (!el || !el.getAttribute) return null;
    var n = parseInt(el.getAttribute('data-source-line'), 10);
    return Number.isFinite(n) ? n : null;
  }

  function pageIndexOf(el) {
    if (!el || !el.closest) return 0;
    var pg = el.closest('.pagedjs_page');
    if (!pg) return 0;
    if (pages.length === 0) refreshPages();
    var idx = pages.indexOf(pg);
    return idx >= 0 ? idx + 1 : 0;
  }

  function sourcedBlocks() {
    return Array.from(document.querySelectorAll('[data-source-line]'));
  }

  // data-source-line resets PER FILE, so a line number is only unambiguous when
  // paired with its chapter (data-chapter-src — the source filename). These two
  // helpers scope line lookups to a chapter so editor<->preview sync maps to the
  // right file in a multi-chapter book.
  function chapterOf(el) {
    var c = el && el.closest ? el.closest('[data-chapter-src]') : null;
    return c ? c.getAttribute('data-chapter-src') : null;
  }

  function blocksInChapter(chapter) {
    if (!chapter) return sourcedBlocks();
    return sourcedBlocks().filter(function (block) {
      return chapterOf(block) === chapter;
    });
  }

  // The block straddling the top of the viewport (greatest top still at/above a
  // reference line just below the viewport edge); falls back to the first block
  // below the fold when scrolled to the very top.
  function topVisibleSourceEl() {
    var blocks = sourcedBlocks();
    if (blocks.length === 0) return null;
    var ref = 4;
    var best = null, bestTop = -Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var top = blocks[i].getBoundingClientRect().top;
      if (top <= ref && top > bestTop) { bestTop = top; best = blocks[i]; }
    }
    if (!best) {
      for (var j = 0; j < blocks.length; j++) {
        if (blocks[j].getBoundingClientRect().top >= 0) { best = blocks[j]; break; }
      }
    }
    return best || blocks[0];
  }

  // {el, line} of the viewport-top source position, with the line interpolated
  // within the straddling block by the viewport top's fractional distance to the
  // next annotated block (source-map only annotates top-level blocks, so the
  // block's start line alone can be tens of lines above the visible content).
  function visibleSourcePosition() {
    var el = topVisibleSourceEl();
    if (!el) return null;
    var line = lineOf(el);
    if (line == null) return { el: el, line: null };
    var ref = 4; // same reference line as topVisibleSourceEl
    var top = el.getBoundingClientRect().top;
    if (top < ref) {
      // Find the next annotated sibling-in-flow (document order, higher line —
      // explicitly constrained to this chapter because source lines restart per
      // file and a following chapter may begin at any line after front matter).
      var blocks = sourcedBlocks();
      var idx = blocks.indexOf(el);
      var chapter = chapterOf(el);
      for (var i = idx + 1; i < blocks.length; i++) {
        if (chapterOf(blocks[i]) !== chapter) break;
        var nl = lineOf(blocks[i]);
        if (nl == null) continue;
        if (nl <= line) break;
        var nextTop = blocks[i].getBoundingClientRect().top;
        if (nextTop > top) {
          var f = Math.max(0, Math.min(1, (ref - top) / (nextTop - top)));
          line = line + Math.round(f * (nl - line));
        }
        break;
      }
    }
    return { el: el, line: line };
  }

  function recordVisibleSource() {
    var pos = visibleSourcePosition();
    lastSourceLine = pos && pos.line != null ? pos.line : -1;
    lastSourceChapter = pos ? chapterOf(pos.el) : null;
  }

  function preserveViewport(change) {
    refreshPages();
    var position = visibleSourcePosition();
    var anchor = position ? {
      el: position.el,
      top: position.el.getBoundingClientRect().top
    } : null;
    change();
    refreshPages();
    if (!anchor) {
      scrollToCurrentPage();
      return;
    }
    ignoreScrollUntil = Date.now() + 300;
    var delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (delta) {
      window.scrollBy({ top: delta, behavior: 'instant' });
    }
    currentPage = detectVisiblePage();
    recordVisibleSource();
  }

  // Resolve a {line, chapter?} target to its enclosing annotated block PLUS the
  // following annotated block, so callers can interpolate within long blocks
  // (markdown-it-source-map only annotates top-level *_open tokens, so a target
  // line deep inside a list/table/paragraph would otherwise snap to the block's
  // start line — measured 35-line snap-backs on real chapters).
  function resolveLinePosition(target) {
    var line = Number(target.line);
    var blocks = blocksInChapter(target.chapter);
    var best = null, bestLine = -Infinity, next = null, nextLine = Infinity;
    for (var i = 0; i < blocks.length; i++) {
      var l = lineOf(blocks[i]);
      if (l == null) continue;
      if (l <= line && l > bestLine) { bestLine = l; best = blocks[i]; }
      else if (l > line && l < nextLine) { nextLine = l; next = blocks[i]; }
    }
    if (!best) return blocks[0] ? { el: blocks[0], line: lineOf(blocks[0]), nextEl: null, nextLine: null } : null;
    return { el: best, line: bestLine, nextEl: next, nextLine: next ? nextLine : null };
  }

  // Resolve a scrollTo/highlight target ({line}|{id}|{selector}|{page} or a bare
  // line number) to a DOM element.
  function resolveTarget(target) {
    if (target == null) return null;
    if (typeof target === 'number') target = { line: target };
    if (target.selector) { try { return document.querySelector(target.selector); } catch (_e) { return null; } }
    if (target.id) return document.getElementById(target.id);
    if (target.page != null) { refreshPages(); return pages[clampPage(target.page) - 1] || null; }
    if (target.line != null) {
      var pos = resolveLinePosition(target);
      return pos ? pos.el : null;
    }
    return null;
  }

  var api = {
    getTotalPages: function () { refreshPages(); return pages.length; },
    getCurrentPage: function () { return currentPage; },
    goToPage: function (n) {
      refreshPages();
      currentPage = clampPage(n);
      scrollToCurrentPage();
      return api.notifyPageChange();
    },
    getPageDimensions: function () {
      refreshPages();
      var page = pages[0] || null;
      var pagesEl = document.querySelector('.pagedjs_pages');
      if (!page) return null;
      return {
        width: currentViewMode === 'single' ? page.offsetWidth : (pagesEl ? pagesEl.scrollWidth : page.offsetWidth),
        height: page.offsetHeight
      };
    },
    firstPage: function () { return api.goToPage(1); },
    prevPage: function (mode) { return api.goToPage(currentPage - pageStep(mode)); },
    nextPage: function (mode) { return api.goToPage(currentPage + pageStep(mode)); },
    lastPage: function () { refreshPages(); return api.goToPage(pages.length); },
    setViewMode: function (mode, silent) {
      preserveViewport(function () {
        currentViewMode = mode || 'two-column';
        document.body.classList.remove('view-single', 'view-spread', 'view-two-column');
        if (mode) document.body.classList.add('view-' + mode);
      });
      if (!silent) return api.notifyPageChange();
    },
    setZoom: function (z, silent) {
      preserveViewport(function () {
        document.documentElement.style.setProperty('--gutterpress-zoom', z);
      });
      if (!silent) api.notifyPageChange();
    },
    toggleDebugMode: function () {
      debugMode = !debugMode;
      document.body.classList.toggle('debug', debugMode);
      return debugMode;
    },
    notifyPageChange: function () {
      var detail = { currentPage: api.getCurrentPage(), totalPages: pages.length };
      window.dispatchEvent(new CustomEvent('pageChanged', { detail: detail }));
      return detail;
    },
    notifyRenderingComplete: function () {
      window.dispatchEvent(new CustomEvent('renderingComplete', {
        detail: { totalPages: pages.length }
      }));
    },
    // Re-read the page list and recompute the current page from the scroll
    // position, then notify. Hosts may call this after replacing paginated DOM
    // so cached page counters and scroll synchronization stay current.
    refresh: function () {
      refreshPages();
      currentPage = detectVisiblePage();
      recordVisibleSource();
      return api.notifyPageChange();
    },

    // ── ADR 0005 generic primitives ─────────────────────────────────────────
    // Bumped whenever a command/event is added so a hot-updated SPA can
    // feature-detect against an older bundled lib.
    getProtocolVersion: function () { return 3; },

    // Publish any debounced reader movement before a host atomically replaces
    // this frame. `silent` lets the shell relay the returned event itself so a
    // queued postMessage from the outgoing frame cannot arrive after the swap.
    flushScroll: function (silent) {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = null;
      return publishScrollPosition(true, silent === true);
    },

    // Heading tree with page + source line — powers chapter jump (UX-013), TOC,
    // minimap, scrollspy. Page math needs same-origin paged.js access, so it
    // lives here rather than being derived host-side.
    getOutline: function () {
      refreshPages();
      var hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      var out = [];
      for (var i = 0; i < hs.length; i++) {
        var h = hs[i];
        var text = (h.textContent || '').trim();
        if (!text) continue;
        out.push({
          level: parseInt(h.tagName.charAt(1), 10),
          text: text,
          id: h.id || null,
          sourceLine: lineOf(h),
          chapter: chapterOf(h),
          page: pageIndexOf(h),
          index: i
        });
      }
      return out;
    },

    // Single anchored-jump primitive: target {line}|{id}|{selector}|{page}.
    // Returns the resolved {page, sourceLine}. Suppresses the scroll-driven
    // pageChanged/sourceLineChanged echo so host-driven jumps don't loop back.
    scrollTo: function (target, opts) {
      opts = opts || {};
      if (typeof target === 'number') target = { line: target };
      var el = null;
      var fraction = 0;
      var nextEl = null;
      if (target && target.line != null && target.selector == null && target.id == null && target.page == null) {
        var pos = resolveLinePosition(target);
        if (pos) {
          el = pos.el;
          if (pos.nextEl && pos.nextLine != null && pos.nextLine > pos.line) {
            nextEl = pos.nextEl;
            fraction = (Number(target.line) - pos.line) / (pos.nextLine - pos.line);
            fraction = Math.max(0, Math.min(1, fraction));
          }
        }
      } else {
        el = resolveTarget(target);
      }
      if (!el) return null;
      ignoreScrollUntil = Date.now() + 350;
      var behavior = opts.smooth ? 'smooth' : 'instant';
      el.scrollIntoView({
        behavior: fraction > 0 ? 'instant' : behavior,
        block: opts.block || 'start',
        inline: 'nearest'
      });
      if (fraction > 0 && nextEl) {
        // Interpolate within the block: nudge the scroll by the target line's
        // fractional distance between this block's top and the NEXT annotated
        // block's top. Only when the next block is genuinely lower on screen —
        // a facing-page or next-column neighbour (top <= ours) degrades to the
        // plain block-top scroll, which is the pre-existing behaviour.
        var top = el.getBoundingClientRect().top;
        var nextTop = nextEl.getBoundingClientRect().top;
        if (nextTop > top) {
          window.scrollBy({ top: fraction * (nextTop - top), behavior: behavior });
        }
      }
      var page = pageIndexOf(el);
      if (page) currentPage = page;
      if (!opts.smooth) recordVisibleSource();
      return { page: page || currentPage, sourceLine: lineOf(el) };
    },

    // Source line + page of the block at the top of the viewport (host scroll
    // position read for preview->editor sync).
    getVisibleSource: function () {
      var pos = visibleSourcePosition();
      return pos ? { sourceLine: pos.line, chapter: chapterOf(pos.el), page: pageIndexOf(pos.el) } : null;
    },

    // Generic, read-only DOM extraction. fields: 'text'|'id'|'sourceLine'|
    // 'page'|'tag'|'rectTop'|{attr:'name'}. No eval, no innerHTML — this is the
    // forward-compat hook that lets the SPA build find/figure-list/etc. with no
    // further lib change.
    queryDom: function (spec) {
      spec = spec || {};
      if (!spec.selector) return [];
      var fields = spec.fields || ['text'];
      var els;
      try { els = Array.from(document.querySelectorAll(spec.selector)); }
      catch (_e) { return []; }
      if (spec.limit && els.length > spec.limit) els = els.slice(0, spec.limit);
      return els.map(function (el) {
        var row = {};
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f === 'text') row.text = (el.textContent || '').trim();
          else if (f === 'id') row.id = el.id || null;
          else if (f === 'sourceLine') row.sourceLine = lineOf(el);
          else if (f === 'page') row.page = pageIndexOf(el);
          else if (f === 'chapter') row.chapter = chapterOf(el);
          else if (f === 'tag') row.tag = el.tagName.toLowerCase();
          else if (f === 'rectTop') row.rectTop = el.getBoundingClientRect().top;
          else if (f && typeof f === 'object' && f.attr) row['attr:' + f.attr] = el.getAttribute(f.attr);
        }
        return row;
      });
    },

    // Toggle a marker class on matched elements (DOM write inside the frame).
    // spec: {line?|id?|selector?, group?, scroll?, transient?, transientMs?}.
    // Powers find-in-page, editor-cursor echo, annotations.
    highlight: function (spec) {
      spec = spec || {};
      var group = spec.group || 'default';
      var els = [];
      if (spec.selector) { try { els = Array.from(document.querySelectorAll(spec.selector)); } catch (_e) {} }
      else if (spec.id) { var byId = document.getElementById(spec.id); if (byId) els = [byId]; }
      else if (spec.line != null) { var one = resolveTarget({ line: spec.line }); if (one) els = [one]; }
      for (var i = 0; i < els.length; i++) {
        els[i].classList.add('gutterpress-hl');
        els[i].setAttribute('data-gutterpress-hl-group', group);
      }
      if (spec.scroll && els[0]) {
        ignoreScrollUntil = Date.now() + 350;
        els[0].scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
        recordVisibleSource();
      }
      if (spec.transient && els.length) {
        setTimeout(function () {
          for (var j = 0; j < els.length; j++) {
            if (els[j].getAttribute('data-gutterpress-hl-group') === group) {
              els[j].classList.remove('gutterpress-hl');
              els[j].removeAttribute('data-gutterpress-hl-group');
            }
          }
        }, spec.transientMs || 1200);
      }
      return { count: els.length };
    },

    clearHighlights: function (group) {
      var sel = group ? '.gutterpress-hl[data-gutterpress-hl-group="' + group + '"]' : '.gutterpress-hl';
      var els = Array.from(document.querySelectorAll(sel));
      for (var i = 0; i < els.length; i++) {
        els[i].classList.remove('gutterpress-hl');
        els[i].removeAttribute('data-gutterpress-hl-group');
      }
      return { cleared: els.length };
    }
  };

  window.previewAPI = api;

  // Default highlight style (preview-only; never part of the PDF build path).
  // Guarded so a minimal/headless DOM (e.g. unit-test harness) can't crash here.
  if (typeof document.createElement === 'function') {
    try {
      var hlStyle = document.createElement('style');
      hlStyle.textContent =
        '.gutterpress-hl{outline:2px solid var(--gutterpress-hl-color,#4ea1ff);outline-offset:2px;' +
        'background:var(--gutterpress-hl-bg,rgba(78,161,255,.14));' +
        'transition:outline-color .2s,background .2s;}';
      (document.head || document.documentElement).appendChild(hlStyle);
    } catch (_e) { /* non-fatal: highlight just renders unstyled */ }
  }

  // Click-to-source: emit elementActivated when the user clicks a source-mapped
  // block. Never preventDefault (links/selection keep working); the host decides
  // whether to act. (ADR 0005)
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-source-line]') : null;
      if (!el) return;
      window.dispatchEvent(new CustomEvent('elementActivated', {
        detail: { sourceLine: lineOf(el), chapter: chapterOf(el), id: el.id || null, tag: el.tagName.toLowerCase() }
      }));
    }, true);
  }

  var observedPageCount = 0;
  var pageObserverQueued = false;
  function publishObservedPageCount() {
    pageObserverQueued = false;
    if (window.__PAGED_RENDERED__ === true) return;
    var count = refreshPages().length;
    if (count > observedPageCount) {
      observedPageCount = count;
      window.dispatchEvent(new CustomEvent('pageChanged', {
        detail: { currentPage: count, totalPages: count }
      }));
    }
  }
  var pageObserver = new MutationObserver(function () {
    if (window.__PAGED_RENDERED__ === true) return;
    if (pageObserverQueued) return;
    pageObserverQueued = true;
    window.requestAnimationFrame(publishObservedPageCount);
  });

  function startPageObserver() {
    var target = document.body || document.documentElement;
    if (!target) return false;
    pageObserver.observe(target, { childList: true, subtree: true });
    return true;
  }

  if (!startPageObserver()) {
    document.addEventListener('DOMContentLoaded', function onReady() {
      document.removeEventListener('DOMContentLoaded', onReady);
      startPageObserver();
    });
  }

  // Scroll tracking
  var scrollTimer = null;
  function publishScrollPosition(force, silent) {
    scrollTimer = null;
    var remainingGuard = ignoreScrollUntil - Date.now();
    if (!force && remainingGuard > 0) {
      scrollTimer = setTimeout(publishScrollPosition, remainingGuard);
      return null;
    }
    if (pages.length === 0) refreshPages();
    if (pages.length === 0) return null;
    var page = detectVisiblePage();
    if (page !== currentPage) {
      currentPage = page;
      if (!silent) api.notifyPageChange();
    }
    // Emit finer-grained source position for editor sync (ADR 0005).
    var pos = visibleSourcePosition();
    var sl = pos ? pos.line : null;
    var chapter = pos ? chapterOf(pos.el) : null;
    if (sl != null && (sl !== lastSourceLine || chapter !== lastSourceChapter)) {
      lastSourceLine = sl;
      lastSourceChapter = chapter;
      var detail = { sourceLine: sl, chapter: chapter, page: pageIndexOf(pos.el) };
      if (!silent) {
        window.dispatchEvent(new CustomEvent('sourceLineChanged', { detail: detail }));
      }
      return detail;
    }
    return null;
  }
  window.addEventListener('scroll', function () {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(publishScrollPosition, 150);
  });

  // Paged.js calls this when rendering is complete
  window.PagedConfig = window.PagedConfig || {};
  window.PagedConfig.after = function (flow) {
    refreshPages();
    observedPageCount = pages.length;
    pageObserver.disconnect();
    currentPage = 1;
    ignoreScrollUntil = Date.now() + 300;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    recordVisibleSource();
    console.log('Paged.js rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
    setTimeout(api.notifyPageChange, 0);
  };
})();
