import { readFile, writeFile } from "node:fs/promises";
import { pagedjsPolyfillTagRegex } from "./pagedjs-marker";

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
      // Remove duplicated cards left behind by the onBreakToken handler.
      // When the handler moves a break to before a card, Paged.js leaves a
      // ghost copy of the card on the current page. This pass walks pages in
      // reverse (so the last/most-complete occurrence is seen first and kept)
      // and removes all earlier duplicates unconditionally.
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
      // Remove pages whose only meaningful content is an empty cards-row
      // (or other empty container) left behind by the break handler. This
      // happens when the polyfill pushes a card's break to the next page —
      // Paged.js leaves an empty parent fragment on the previous page.
      for (var k = 0; k < pages.length; k++) {
        var pc = pages[k].querySelector('.pagedjs_page_content');
        if (!pc) continue;
        // Walk down through single-child wrappers to find the deepest content
        var node = pc;
        while (node && node.children && node.children.length === 1) {
          node = node.children[0];
        }
        // If we ended up at an empty container that was meant to hold cards
        // (or any element with no text content and no images/cards inside),
        // mark the page as orphaned.
        var text = (pc.innerText || '').trim();
        var hasContent = pc.querySelector('img, table, h1, h2, h3, h4, [data-break-inside="avoid"]');
        if (text.length === 0 && !hasContent) {
          pages[k].setAttribute('data-orphan-page', 'true');
          pages[k].style.display = 'none';
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
  // Detection MUST use only the stable marker/filename regex owned by
  // pagedjs-marker.ts — never a bare `pagedjs` substring test. A document
  // whose body TEXT merely mentions "pagedjs" (e.g. this project's own user
  // guide) is not evidence of an existing polyfill slot; treating it as one
  // previously fell through to a branch that injected the break handler
  // WITHOUT the polyfill script, so Paged.js never loaded and
  // __PAGED_RENDERED__ never fired (see finding #22 / the 60-minute stall).
  const hasPagedSlot = pagedjsPolyfillTagRegex().test(html);

  let patched = html;
  const inject = `${BREAK_INSIDE_HANDLER}\n<script src="${vendorPath.replace(/\\/g, "/")}"></script>`;

  if (hasPagedSlot) {
    // Paged.js slot already present — replace it (stable marker, or a legacy
    // paged.polyfill src) with handler + local vendor copy so
    // PagedConfig.before is set before execution.
    const match = patched.match(pagedjsPolyfillTagRegex());
    if (match) {
      patched = patched.replace(match[0], inject);
      await writeFile(htmlPath, patched, "utf8");
      return;
    }
    // Defensive fallback: hasPagedSlot used the same regex, so this should be
    // unreachable, but if it ever diverges, always fall through to a FULL
    // injection (handler + polyfill) — never handler-only — so the polyfill
    // is guaranteed present either way.
  }

  if (patched.includes("</head>")) {
    patched = patched.replace("</head>", `${inject}\n</head>`);
  } else {
    patched = inject + "\n" + patched;
  }

  await writeFile(htmlPath, patched, "utf8");
}
