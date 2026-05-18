// Cross-origin postMessage bridge for window.previewAPI.
//
// The viewer (Svelte toolbar) and this iframe are on different origins
// (SvelteKit on port A, print-md preview on port B), so the toolbar can't
// reach window.previewAPI directly. This bridge listens for command
// messages, calls the local previewAPI, and posts results / events back to
// the parent window.
//
// Protocol:
//   parent -> iframe: { type: 'pmd:cmd', id: <number>, cmd: <string>, args?: [...] }
//   iframe -> parent: { type: 'pmd:reply', id: <number>, ok: true, result: <any> }
//                  or { type: 'pmd:reply', id: <number>, ok: false, error: <string> }
//   iframe -> parent: { type: 'pmd:event', name: 'pageChanged'|'renderingComplete'|'ready', detail }
//
// Commands map 1:1 to previewAPI methods: getTotalPages, getCurrentPage,
// goToPage, firstPage, prevPage, nextPage, lastPage, setViewMode, setZoom,
// toggleDebugMode. Plus a synthetic 'print' command that calls window.print().

(function () {
  'use strict';

  function post(msg) {
    try {
      window.parent.postMessage(msg, '*');
    } catch (_e) {
      // No parent or sandboxed; ignore.
    }
  }

  function call(cmd, args) {
    if (cmd === 'print') {
      window.print();
      return true;
    }
    var api = window.previewAPI;
    if (!api || typeof api[cmd] !== 'function') {
      throw new Error('Unknown command: ' + cmd);
    }
    return api[cmd].apply(api, args || []);
  }

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'pmd:cmd') return;
    var id = data.id;
    try {
      var result = call(data.cmd, data.args);
      post({ type: 'pmd:reply', id: id, ok: true, result: result });
    } catch (err) {
      post({
        type: 'pmd:reply',
        id: id,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  });

  window.addEventListener('pageChanged', function (e) {
    post({ type: 'pmd:event', name: 'pageChanged', detail: e.detail });
  });
  window.addEventListener('renderingComplete', function (e) {
    post({ type: 'pmd:event', name: 'renderingComplete', detail: e.detail });
  });

  // Announce readiness as soon as previewAPI is defined.
  function announceReady() {
    if (window.previewAPI) {
      post({ type: 'pmd:event', name: 'ready', detail: {} });
    } else {
      setTimeout(announceReady, 50);
    }
  }
  announceReady();

  // Set background color via inline style on <html> (toolbar's bg-color picker).
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'pmd:bg-color') return;
    document.documentElement.style.background = data.color;
  });
})();
