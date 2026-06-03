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
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var threshold = scrollTop + window.innerHeight / 3;
    var page = 1;
    var pageTop = pages[0].offsetTop;
    for (var i = pages.length - 1; i >= 0; i--) {
      if (pages[i].offsetTop <= threshold) {
        pageTop = pages[i].offsetTop;
        break;
      }
    }
    for (var j = 0; j < pages.length; j++) {
      if (Math.abs(pages[j].offsetTop - pageTop) < 2) {
        page = j + 1;
        break;
      }
    }
    return page;
  }

  function scrollToCurrentPage() {
    if (pages.length === 0) return;
    var page = clampPage(currentPage);
    currentPage = page;
    ignoreScrollUntil = Date.now() + 300;
    pages[page - 1].scrollIntoView({ behavior: 'instant', block: 'start', inline: 'nearest' });
  }

  function pageStep() {
    return currentViewMode === 'single' ? 1 : 2;
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
    prevPage: function () { return api.goToPage(currentPage - pageStep()); },
    nextPage: function () { return api.goToPage(currentPage + pageStep()); },
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
