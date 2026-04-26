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
    if (typeof Paged !== 'undefined' && Paged.Handler && Paged.registerHandlers) {
      class BreakInsideAvoidHandler extends Paged.Handler {
        constructor(chunker, polisher, caller) {
          super(chunker, polisher, caller);
          this._lastRef = null;
          // Cards we've already approved to split internally — never try to
          // keep them whole again. Without this, an oversized card whose first
          // internal break is allowed will be re-trapped on subsequent breaks
          // (table cells, paragraphs, list items inside it) and Paged.js loops.
          this._splitAllowed = new Set();
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
                // Permanent split-allowed flag: once we let a card split,
                // every subsequent break inside it is approved without
                // re-trying the move-before-card dance.
                if (ref && this._splitAllowed.has(ref)) {
                  return breakToken;
                }
                // Only skip if this is the same element we just moved AND it
                // has no previous sibling — meaning it's first on the page and
                // truly too tall to fit. If it has siblings, content before it
                // can be moved to make room, so always allow the move.
                if (ref && ref === this._lastRef && !node.previousElementSibling) {
                  this._splitAllowed.add(ref);
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
      // instance of each card and removing earlier occurrences.
      // Walk pages in reverse: the last occurrence of each data-ref is seen
      // first and kept. Any earlier occurrence with the same ref is a split
      // fragment left by the break-inside handler and is always removed.
      //
      // Special case — legitimately split cards: when a card is too tall to
      // fit on one page, Paged.js splits it and marks continuations with
      // data-split-from. The START fragment has no data-split-from. Walking
      // in reverse we see a continuation first (added to seen), then the start
      // fragment (no data-split-from, ref in seen) — which we must NOT remove
      // because it is the genuine first half of the split, not a polyfill ghost.
      // Track refs seen WITH data-split-from so the start fragment is kept.
      var pages = document.querySelectorAll('.pagedjs_page');
      var seen = new Set();
      var splitContinuations = new Set(); // refs whose continuation was already seen
      for (var i = pages.length - 1; i >= 0; i--) {
        var content = pages[i].querySelector('.pagedjs_page_content');
        if (!content) continue;
        var cards = content.querySelectorAll('[data-break-inside="avoid"]');
        for (var j = cards.length - 1; j >= 0; j--) {
          var card = cards[j];
          var ref = card.getAttribute('data-ref');
          if (!ref) continue;
          var hasSplitFrom = card.hasAttribute('data-split-from');
          if (hasSplitFrom) {
            splitContinuations.add(ref);
          }
          if (seen.has(ref)) {
            // Earlier occurrence of a card we already kept — remove it only
            // if it is a polyfill ghost (no data-split-from AND the ref has
            // no known split continuation). If a continuation exists, this is
            // the legitimate start fragment of a multi-page split — keep it.
            if (!hasSplitFrom && !splitContinuations.has(ref)) {
              card.parentNode.removeChild(card);
            }
          } else {
            seen.add(ref);
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
    // Paged.js already present — inject handler BEFORE the Paged.js script
    // so PagedConfig.before is set before the polyfill executes.
    // Replace the existing script tag with handler + local vendor copy.
    const pagedScriptRegex = /<script[^>]*src=["'][^"']*paged[^"']*["'][^>]*><\/script>/i;
    const match = patched.match(pagedScriptRegex);

    if (match) {
      const inject = `${BREAK_INSIDE_HANDLER}\n<script src="${vendorPath.replace(/\\/g, "/")}"></script>`;
      patched = patched.replace(match[0], inject);
    } else if (patched.includes("</head>")) {
      const inject = `${BREAK_INSIDE_HANDLER}\n${markerScript}`;
      patched = patched.replace("</head>", `${inject}\n</head>`);
    } else {
      const inject = `${BREAK_INSIDE_HANDLER}\n${markerScript}`;
      patched = inject + "\n" + patched;
    }
  }

  await writeFile(htmlPath, patched, "utf8");
}
