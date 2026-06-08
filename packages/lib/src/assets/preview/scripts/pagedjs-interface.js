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
    // offsetTop. The viewer applies CSS `zoom` for fit-width; under `zoom`,
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
  }

  function pageStep(mode) {
    return (mode || currentViewMode) === 'single' ? 1 : 2;
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
    setViewMode: function (mode) {
      refreshPages();
      currentViewMode = mode || 'two-column';
      document.body.classList.remove('view-single', 'view-spread', 'view-two-column');
      if (mode) document.body.classList.add('view-' + mode);
      scrollToCurrentPage();
      return api.notifyPageChange();
    },
    setZoom: function (z) {
      document.documentElement.style.setProperty('--pmd-zoom', z);
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
    // position, then notify. The incremental preview shell calls this after it
    // splices a chapter's pages into the live DOM (Paged.js does NOT re-run, so
    // the cached page list and counters would otherwise go stale — freezing the
    // toolbar's page number and breaking scroll sync).
    refresh: function () {
      refreshPages();
      currentPage = detectVisiblePage();
      return api.notifyPageChange();
    }
  };

  window.previewAPI = api;

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
  window.addEventListener('scroll', function () {
    if (pages.length === 0) refreshPages();
    if (pages.length === 0) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      if (Date.now() < ignoreScrollUntil) return;
      var page = detectVisiblePage();
      if (page !== currentPage) {
        currentPage = page;
        api.notifyPageChange();
      }
    }, 150);
  });

  // Paged.js calls this when rendering is complete
  window.PagedConfig = window.PagedConfig || {};
  window.PagedConfig.after = function (flow) {
    refreshPages();
    observedPageCount = pages.length;
    pageObserver.disconnect();
    currentPage = 1;
    ignoreScrollUntil = Date.now() + 300;
    window.scrollTo(0, 0);
    console.log('Paged.js rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
    setTimeout(api.notifyPageChange, 0);
  };
})();
