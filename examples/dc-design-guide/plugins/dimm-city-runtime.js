/**
 * Dimm City runtime — browser-side helpers that run alongside Paged.js.
 *
 * Loaded via a `<script>` tag injected by dimm-city-plugin.js. Chains into
 * `window.PagedConfig.before/after` so it integrates with whatever the host
 * pipeline (print-md preview, build, etc.) already has registered.
 *
 * Currently does:
 *   - Card-split continuation markers
 *     When a `.card-fillable` skill card splits across pages, Paged.js sets
 *     `data-split-from` on continuation fragments and `data-split-to` on
 *     originating ones. We inject real DOM markers (not pseudo-elements)
 *     because augmented-ui hijacks ::before/::after on data-augmented-ui
 *     card bodies.
 */
(function () {
  'use strict';

  function injectCardSplitMarkers() {
    try {
      document.querySelectorAll('.card-fillable[data-split-from]').forEach(function (card) {
        if (card.querySelector(':scope > .card-cont-marker')) return;
        var m = document.createElement('div');
        m.className = 'card-cont-marker';
        m.textContent = '▸ continued';
        card.insertBefore(m, card.firstChild);
      });
      document.querySelectorAll('.card-fillable[data-split-to]:not([data-split-from])').forEach(function (card) {
        if (card.querySelector(':scope > .card-fwd-marker')) return;
        var m = document.createElement('div');
        m.className = 'card-fwd-marker';
        m.textContent = '▸';
        card.appendChild(m);
      });
    } catch (e) {
      console.warn('[dimm-city-runtime] card-marker injection failed:', e);
    }
  }

  function chainAfter() {
    var prev = window.PagedConfig && window.PagedConfig.after;
    (window.PagedConfig = window.PagedConfig || {}).after = function (flow) {
      injectCardSplitMarkers();
      if (typeof prev === 'function') return prev(flow);
    };
  }

  // Chain via `before()` so we capture whatever `after` handlers other
  // scripts (e.g. print-md's BreakInsideAvoidHandler) install during their
  // own `before()` pass.
  var origBefore = window.PagedConfig && window.PagedConfig.before;
  (window.PagedConfig = window.PagedConfig || {}).before = function () {
    var ret = typeof origBefore === 'function' ? origBefore() : undefined;
    chainAfter();
    return ret;
  };
})();
