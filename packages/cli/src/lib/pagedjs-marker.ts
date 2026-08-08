/**
 * Single source of truth for the Paged.js polyfill `<script>` slot.
 *
 * PURE / node-free by design: this module imports nothing (no `node:*`, no `fs`),
 * so it can be shared by BOTH the pure, browser-usable HTML assembler
 * (`markdown/assemble.ts`) and the node-side build/preview rewriters
 * (`build-runner.ts`, `pagedjs.ts`, `preview/file-watcher.ts`).
 *
 * The contract between the assembler and every rewriter is the stable
 * `data-pagedjs-polyfill` MARKER ATTRIBUTE — never a URL, filename, or version
 * substring. Core emits the marker; the rewriters find/strip/replace it by
 * attribute. A pagedjs version bump or attribute reorder therefore cannot
 * silently break the strip/replace passes, and the un-rewritten `book.html`
 * carries NO network dependency (there is no live CDN URL to leak).
 */

/**
 * Pinned Paged.js version. Bump HERE only — the value is emitted purely as
 * documentation on the marker tag; matching never depends on it.
 */
export const PAGEDJS_VERSION = "0.4.3";

/** Stable marker attribute identifying the Paged.js polyfill script slot. */
export const PAGEDJS_POLYFILL_MARKER = "data-pagedjs-polyfill";

/**
 * The polyfill `<script>` slot Gutterpress core emits into `book.html`. Carries the
 * stable marker (with the intended version as its value, for greppability) and
 * NO `src` — an un-rewritten `book.html` has zero network dependency. Every
 * consumer replaces this slot with a locally-vendored polyfill before the book
 * is ever loaded (build staging, the no-Chromium runtime fallback, live preview).
 */
export function pagedjsPolyfillTag(version: string = PAGEDJS_VERSION): string {
  return `<script ${PAGEDJS_POLYFILL_MARKER}="${version}"></script>`;
}

/**
 * Match the polyfill `<script>` slot. Matches EITHER the stable marker attribute
 * (core output) OR a `paged.polyfill` `src` (legacy CDN / vendored copy that a
 * staging/patch pass has already swapped in) — so the same matcher works at every
 * stage of the pipeline. Deliberately matches `paged.polyfill` (the version-
 * stable FILENAME), never a bare `pagedjs` substring, so the navigation toolbar
 * scripts (`preview-interface.js` / `preview-bridge.js`) are left untouched.
 *
 * Attribute-order tolerant and version-agnostic. Returns a FRESH RegExp per call
 * so the `g` flag's `lastIndex` is never shared between callers.
 */
export function pagedjsPolyfillTagRegex(): RegExp {
  return /<script\b[^>]*(?:\bdata-pagedjs-polyfill\b|\bsrc=["'][^"']*paged\.polyfill[^"']*["'])[^>]*>\s*<\/script>/gi;
}
