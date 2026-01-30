// Interface adapter: exposes window.previewAPI for the parent toolbar.
// Paged.js paginates into .pagedjs_page elements. We use PagedConfig.after
// to know when rendering is done.

(function () {
  'use strict';

  var pages = [];
  var currentIndex = 0;
  var debugMode = false;

  function refreshPages() {
    pages = Array.from(document.querySelectorAll('.pagedjs_page'));
    return pages;
  }

  function detectCurrentPage() {
    if (pages.length === 0) return 0;
    var scrollTop = window.scrollY || document.documentElement.scrollTop;
    var threshold = scrollTop + window.innerHeight / 3;
    for (var i = pages.length - 1; i >= 0; i--) {
      if (pages[i].offsetTop <= threshold) return i;
    }
    return 0;
  }

  var api = {
    getTotalPages: function () { refreshPages(); return pages.length; },
    getCurrentPage: function () { return currentIndex + 1; },
    goToPage: function (n) {
      refreshPages();
      currentIndex = Math.max(0, Math.min(n - 1, pages.length - 1));
      pages[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
      api.notifyPageChange();
    },
    firstPage: function () { api.goToPage(1); },
    prevPage: function () { api.goToPage(currentIndex); },
    nextPage: function () { api.goToPage(currentIndex + 2); },
    lastPage: function () { api.goToPage(pages.length); },
    setViewMode: function () {},
    setZoom: function (z) {
      document.body.style.transformOrigin = 'top center';
      document.body.style.transform = 'scale(' + z + ')';
    },
    toggleDebugMode: function () {
      debugMode = !debugMode;
      refreshPages();
      pages.forEach(function (p) { p.style.outline = debugMode ? '2px solid red' : ''; });
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
    console.log('Paged.js rendered ' + pages.length + ' pages');
    api.notifyRenderingComplete();
  };
})();
