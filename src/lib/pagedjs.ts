import { readFile, writeFile } from "node:fs/promises";

/**
 * Inline script that polyfills Paged.js's missing break-inside: avoid support.
 *
 * Paged.js has an avoidBreakInside() method but never calls it. This handler
 * intercepts onBreakToken and, when the break lands inside an element with
 * data-break-inside="avoid", moves the break to before that element.
 *
 * Uses a data attribute (not CSS) because source nodes are disconnected from
 * the DOM when onBreakToken fires, so getComputedStyle returns empty values.
 *
 * Must be registered via PagedConfig.before (runs before Paged.js renders).
 */
export const BREAK_INSIDE_HANDLER = `
<script>
(function() {
  window.PagedConfig = window.PagedConfig || {};
  var origBefore = window.PagedConfig.before;
  window.PagedConfig.before = function() {
    // Pre-scan: remove data-break-inside="avoid" from cards taller than the
    // page content area. These cards MUST be allowed to split — otherwise
    // Paged.js's CSS column layout wraps overflow to the top of the page,
    // hiding text content behind the card header.
    // Measures each card inside an off-screen container matching page content
    // width so :only-child cards get measured at their paginated width.
    (function() {
      // Read page dimensions from @page rules via Paged.js CSS vars or stylesheet
      var root = document.documentElement;
      var cs = getComputedStyle(root);
      var pageH = parseFloat(cs.getPropertyValue('--pagedjs-height')) || 0;
      var mTop = parseFloat(cs.getPropertyValue('--pagedjs-margin-top')) || 0;
      var mBot = parseFloat(cs.getPropertyValue('--pagedjs-margin-bottom')) || 0;
      var pageW = parseFloat(cs.getPropertyValue('--pagedjs-width')) || 0;
      var mLeft = parseFloat(cs.getPropertyValue('--pagedjs-margin-left')) || 0;
      var mRight = parseFloat(cs.getPropertyValue('--pagedjs-margin-right')) || 0;
      // Convert inches to pixels (96dpi CSS reference pixel)
      var contentH = (pageH - mTop - mBot) * 96;
      var contentW = (pageW - mLeft - mRight) * 96;
      if (contentH <= 0) contentH = 920;
      if (contentW <= 0) contentW = 732;
      // Create off-screen measurement container at page content width
      var measure = document.createElement('div');
      measure.style.cssText = 'position:absolute;left:-99999px;top:0;width:' + contentW + 'px;overflow:visible;visibility:hidden;';
      document.body.appendChild(measure);
      var cards = document.querySelectorAll('[data-break-inside="avoid"]');
      for (var k = 0; k < cards.length; k++) {
        var card = cards[k];
        var parent = card.parentNode;
        var next = card.nextSibling;
        // Move into measurement container (card becomes :only-child → full width)
        measure.appendChild(card);
        var h = card.scrollHeight;
        // Move back to original position
        if (next) parent.insertBefore(card, next);
        else parent.appendChild(card);
        if (h > contentH) {
          card.setAttribute('data-break-inside', 'split');
        }
      }
      document.body.removeChild(measure);
    })();
    if (typeof Paged !== 'undefined' && Paged.Handler && Paged.registerHandlers) {
      class BreakInsideAvoidHandler extends Paged.Handler {
        constructor(chunker, polisher, caller) {
          super(chunker, polisher, caller);
          this._lastRef = null;
        }
        onBreakToken(breakToken) {
          if (!breakToken || !breakToken.node) return breakToken;
          var node = breakToken.node;
          while (node && node.nodeType !== undefined) {
            if (node.nodeType === 1) {
              // Source nodes are disconnected so getComputedStyle won't work.
              // Check data-break-inside attribute instead.
              if (node.getAttribute && node.getAttribute('data-break-inside') === 'avoid') {
                var ref = node.getAttribute('data-ref');
                // Only skip if this is the same element we just moved AND it
                // has no previous sibling — meaning it's first on the page and
                // truly too tall to fit. If it has siblings, content before it
                // can be moved to make room, so always allow the move.
                if (ref && ref === this._lastRef && !node.previousElementSibling) {
                  this._lastRef = null;
                  return breakToken;
                }
                this._lastRef = ref;
                breakToken.node = node;
                breakToken.offset = 0;
                return breakToken;
              }
            }
            node = node.parentNode;
          }
          this._lastRef = null;
          return breakToken;
        }
      }
      Paged.registerHandlers(BreakInsideAvoidHandler);
    }
    // Post-render cleanup: chain into PagedConfig.after (called by Paged.js
    // when rendering finishes). We capture the current after handler here
    // (inside before()) because all scripts have loaded by this point.
    var origAfter = window.PagedConfig.after;
    window.PagedConfig.after = function(flow) {
      // Remove duplicated and empty-shell cards.
      // The onBreakToken handler moves breaks before cards, but Paged.js
      // doesn't remove the already-rendered clone from the current page.
      // This pass deduplicates by keeping only the LAST (most complete)
      // instance of each card and removing earlier empty/duplicate copies.
      var pages = document.querySelectorAll('.pagedjs_page');
      var seen = new Map();
      for (var i = pages.length - 1; i >= 0; i--) {
        var content = pages[i].querySelector('.pagedjs_page_content');
        if (!content) continue;
        var cards = content.querySelectorAll('[data-break-inside="avoid"]');
        for (var j = cards.length - 1; j >= 0; j--) {
          var card = cards[j];
          var ref = card.getAttribute('data-ref');
          if (!ref) continue;
          if (seen.has(ref)) {
            card.parentNode.removeChild(card);
          } else {
            seen.set(ref, true);
          }
        }
      }
      // Signal completion for the build pipeline
      window.__PAGED_RENDERED__ = true;
      if (origAfter) return origAfter(flow);
    };
    if (origBefore) return origBefore();
  };
})();
</script>`.trim();

/**
 * Inject the Paged.js polyfill + render-complete marker into an HTML file.
 * Modifies the file in-place.
 */
export async function patchHtmlForPagedjs(
  htmlPath: string,
  vendorPath: string
): Promise<void> {
  const html = await readFile(htmlPath, "utf8");
  const hasPaged =
    /paged\.(polyfill|js)/i.test(html) || /pagedjs/i.test(html);

  // Marker is now set inside BREAK_INSIDE_HANDLER's PagedConfig.after chain.
  // This empty string keeps injection logic unchanged.
  const markerScript = '';

  let patched = html;

  if (!hasPaged) {
    const inject = `
${BREAK_INSIDE_HANDLER}
<script src="${vendorPath.replace(/\\/g, "/")}"></script>
${markerScript}`.trim();

    if (patched.includes("</head>")) {
      patched = patched.replace("</head>", `${inject}\n</head>`);
    } else {
      patched = inject + "\n" + patched;
    }
  } else if (!patched.includes("__PAGED_RENDERED__")) {
    // Paged.js already present — inject handler + marker only
    const inject = `${BREAK_INSIDE_HANDLER}\n${markerScript}`;
    if (patched.includes("</head>")) {
      patched = patched.replace("</head>", `${inject}\n</head>`);
    } else {
      patched = inject + "\n" + patched;
    }
  }

  await writeFile(htmlPath, patched, "utf8");
}
