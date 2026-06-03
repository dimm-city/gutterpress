// Interface adapter: exposes window.previewAPI for the parent toolbar.
// Paged.js paginates into .pagedjs_page elements. We use PagedConfig.after
// to know when rendering is done.

(function () {
  'use strict';

  var pages = [];
  var currentIndex = 0;
  var debugMode = false;
  var currentViewMode = 'two-column';

  function refreshPages() {
    pages = Array.from(document.querySelectorAll('.pagedjs_page'));
    return pages;
  }

  function detectCurrentPage() {
    if (pages.length === 0) return 0;
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var threshold = scrollTop + window.innerHeight / 3;
    for (var i = pages.length - 1; i >= 0; i--) {
      if (pages[i].offsetTop <= threshold) {
        if (currentViewMode !== 'single' && i % 2 === 1) return i - 1;
        return i;
      }
    }
    return 0;
  }

  function normalizeTargetPage(n) {
    var clamped = Math.max(1, Math.min(n, pages.length));
    if (currentViewMode === 'single' || clamped <= 1) return clamped;
    return clamped % 2 === 0 ? clamped - 1 : clamped;
  }

  var api = {
    getTotalPages: function () { refreshPages(); return pages.length; },
    getCurrentPage: function () { return currentIndex + 1; },
    goToPage: function (n) {
      refreshPages();
      var target = normalizeTargetPage(n);
      currentIndex = Math.max(0, Math.min(target - 1, pages.length - 1));
      // Use 'instant' so the scroll completes synchronously before notifyPageChange
      // fires. 'smooth' interacts with the scroll-listener debounce timer and causes
      // the parent Svelte toolbar to receive a stale page number on fast navigation.
      pages[currentIndex].scrollIntoView({ behavior: 'instant', block: 'start' });
      api.notifyPageChange();
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
    firstPage: function () { api.goToPage(1); },
    prevPage: function () { api.goToPage(currentIndex + 1 - (currentViewMode === 'single' ? 1 : 2)); },
    nextPage: function () { api.goToPage(currentIndex + 1 + (currentViewMode === 'single' ? 1 : 2)); },
    lastPage: function () { api.goToPage(pages.length); },
    setViewMode: function (mode) {
      currentViewMode = mode || 'two-column';
      document.body.classList.remove('view-single', 'view-spread', 'view-two-column');
      if (mode) document.body.classList.add('view-' + mode);
      currentIndex = detectCurrentPage();
      api.notifyPageChange();
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
      window.dispatchEvent(new CustomEvent('pageChanged', {
        detail: { currentPage: api.getCurrentPage(), totalPages: pages.length }
      }));
    },
    notifyRenderingComplete: function () {
      window.dispatchEvent(new CustomEvent('renderingComplete', {
        detail: { totalPages: pages.length }
      }));
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
  pageObserver.observe(document.body, { childList: true, subtree: true });

  // Scroll tracking
  var scrollTimer = null;
  window.addEventListener('scroll', function () {
    if (pages.length === 0) return;
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () {
      var idx = detectCurrentPage();
      if (idx !== currentIndex) {
        currentIndex = idx;
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
    console.log('Paged.js rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
  };
})();
