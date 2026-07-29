// Cross-origin postMessage bridge for window.previewAPI.
//
// The desktop (Svelte toolbar) and this iframe are on different origins
// (SvelteKit on port A, gutterpress preview on port B), so the toolbar can't
// reach window.previewAPI directly. This bridge listens for command
// messages, calls the local previewAPI, and posts results / events back to
// the parent window.
//
// Protocol:
//   parent -> iframe: { type: 'gutterpress:cmd', id: <number>, cmd: <string>, args?: [...] }
//   iframe -> parent: { type: 'gutterpress:reply', id: <number>, ok: true, result: <any> }
//                  or { type: 'gutterpress:reply', id: <number>, ok: false, error: <string> }
//   iframe -> parent: { type: 'gutterpress:event', name: 'pageChanged'|'renderingComplete'|'ready', detail }
//
// Commands map 1:1 to previewAPI methods: getTotalPages, getCurrentPage,
// goToPage, firstPage, prevPage, nextPage, lastPage, setViewMode, setZoom,
// toggleDebugMode. Plus a synthetic 'print' command that calls window.print().
//
// Additional messages:
//   parent -> iframe: { type: 'gutterpress:inject-styles', id: <attr-name>, css: <string> }
//     Inserts or replaces a <style data-{id}="true"> block in the iframe's <head>.
//     Used to push view-mode CSS and debug CSS into the cross-origin iframe.

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
    if (!data || data.type !== 'gutterpress:cmd') return;
    var id = data.id;
    try {
      var result = call(data.cmd, data.args);
      post({ type: 'gutterpress:reply', id: id, ok: true, result: result });
    } catch (err) {
      post({
        type: 'gutterpress:reply',
        id: id,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  });

  window.addEventListener('pageChanged', function (e) {
    post({ type: 'gutterpress:event', name: 'pageChanged', detail: e.detail });
  });
  window.addEventListener('renderingComplete', function (e) {
    post({ type: 'gutterpress:event', name: 'renderingComplete', detail: e.detail });
  });
  // ADR 0005: source-position sync + click-to-source.
  window.addEventListener('sourceLineChanged', function (e) {
    post({ type: 'gutterpress:event', name: 'sourceLineChanged', detail: e.detail });
  });
  window.addEventListener('elementActivated', function (e) {
    post({ type: 'gutterpress:event', name: 'elementActivated', detail: e.detail });
  });

  // Announce readiness as soon as previewAPI is defined.
  function announceReady() {
    if (window.previewAPI) {
      post({ type: 'gutterpress:event', name: 'ready', detail: {} });
    } else {
      setTimeout(announceReady, 50);
    }
  }
  announceReady();

  // Set background color via inline style on <html> (toolbar's bg-color picker).
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'gutterpress:bg-color') return;
    document.documentElement.style.background = data.color;
  });

  // Inject or replace a named <style> block in the iframe's <head>.
  // { type: 'gutterpress:inject-styles', id: <string>, css: <string> }
  // The <style> element gets data-gutterpress-<id>="true" so subsequent calls update
  // the same block rather than appending duplicates.
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data || data.type !== 'gutterpress:inject-styles') return;
    var attrName = 'data-gutterpress-' + data.id;
    var existing = document.querySelector('style[' + attrName + ']');
    if (!existing) {
      existing = document.createElement('style');
      existing.setAttribute(attrName, 'true');
      document.head.appendChild(existing);
    }
    existing.textContent = data.css;
  });
})();
