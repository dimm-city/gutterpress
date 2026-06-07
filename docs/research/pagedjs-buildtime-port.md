# Paged.js as a Static Site Generator (build-time pagination)

**Status: PROTOTYPED & VERIFIED — `--format html` now emits pre-paginated static HTML**
**Date: 2026-06-07**
**Branch: `feat/pagedjs-static-html`**

## Goal (corrected)

Make Paged.js behave like a **static site generator, not a runtime polyfill.**
Today print-md ships `paged.polyfill.js` and the browser re-runs the entire
pagination engine **on every load** — modifying the DOM and laying out each page
with JavaScript. The goal is to run that pagination **once, at build time**, and
ship **static, already-paginated HTML** so the browser renders pages with **only
CSS — no runtime pagination JS.**

This is *not* a rewrite of the layout engine. Earlier research chased a pure-JS
re-implementation (Taffy/Satori/etc.) and a Chromium-snapshot "freeze"; both were
wrong framings. The right framing is the obvious one: **Paged.js already produces
the static pages — just run it at build and serialize the result**, exactly like
the upstream `pagedjs-cli` does for PDF. Pagination genuinely needs a layout
engine, so the build pays for one headless Chromium pass (the PDF path already
does); the *runtime* becomes pure static HTML + CSS.

## How it works

The build-time HTML path now:

1. **Stages** the rendered `book.html` + assets + the vendored `paged.polyfill.js`.
2. **Patches** it with the existing `BREAK_INSIDE_HANDLER` so `break-inside:avoid`
   + ghost-card/orphan cleanup run **during the build pass**.
3. **Paginates once** in headless Chromium (`paginateToStaticHtml()`), waits for
   `__PAGED_RENDERED__`, then serializes `document.documentElement.outerHTML`.
   Paged.js's polisher injects its layout CSS as `<style>` elements **into the
   DOM**, so the serialized markup already carries the page-box sizing, margin
   boxes, `@page` rules, and named-page styles.
4. **Strips the engine** (`stripPaginationRuntime()`): removes the
   `paged.polyfill.js` `<script src>` and the inline `BreakInsideAvoidHandler`
   block, so the browser will **not** re-paginate the already-fragmented DOM.
5. **Keeps navigation-only scripts** (`injectNavigationScripts()`):
   `pagedjs-interface.js` + `pagedjs-bridge.js` scroll between existing pages and
   handle zoom/view-mode; they read the pre-rendered `.pagedjs_page` elements and
   never paginate.

All changes are in `packages/lib/src/lib/build-runner.ts`: three new functions
(`paginateToStaticHtml`, `stripPaginationRuntime`, `injectNavigationScripts`) and
a rewritten `if (format === "html")` branch. No new dependencies.

## Why the runtime is genuinely CSS-only

Fragmentation is baked into the DOM (one `.pagedjs_page` div per printed page),
and Paged.js's computed layout CSS is inlined as `<style>` blocks. So:

- **Screen** renders the static page stack directly from CSS.
- **PDF** (future unification) prints that same static artifact, making
  **screen == PDF pixel-identical by construction** (one artifact, two consumers).
- Counters, running headers, named pages, `@page` size — all resolved at build
  and present as real DOM/CSS, not engine state.

## Verification (this prototype, not a prior build)

Built `examples/print-md-user-guide` with `--format html`:

| Check | Baseline (today) | This build |
|---|---|---|
| Pre-paginated `.pagedjs_page` divs in output | **0** | **59** |
| `paged.polyfill.js` `<script>` shipped | yes | **0 (removed)** |
| Inline `BreakInsideAvoidHandler` shipped | n/a | **0 (removed)** |
| `<script>` tags remaining | polyfill + nav | **nav only (2)** |
| Renders with **JavaScript disabled** | no (blank) | **yes — 59 pages** |
| First page box, JS disabled | n/a | **816×1056px = 8.5×11in** |

A headless load with `setJavaScriptEnabled(false)` produced 59 correctly-sized
pages with full styling (verified visually on the cover spread). The browser does
zero DOM pagination.

## Scope & follow-ups

This prototype covers **`--format html` only** (as scoped). Known follow-ups
before it ships as the default:

1. **Chromium preflight for HTML.** `--format html` now requires a headless
   browser at build (it didn't before). Add it to `preflightBuildTools` and offer
   a graceful fallback (ship the polyfill) when Chromium is absent, so non-PDF
   users aren't hard-blocked.
2. **`renderingComplete` wiring.** `pagedjs-interface.js` fires that event from
   `PagedConfig.after`, which never runs without the engine. Re-wire it to a
   `DOMContentLoaded` dispatch (~10–20 lines) so the toolbar gets its page count.
3. **Viewer parity.** The Electron viewer injects its own renderer for PDF; it
   needs an analogous injected serializer so the desktop app produces the same
   static HTML without a separate Chromium.
4. **PDF unification (next phase).** Run the single pagination pass once and emit
   *both* the static HTML and the PDF (print the static artifact) — guarantees
   screen==PDF and avoids a second Chromium launch.
5. **Output size.** Static output is larger (70KB → ~648KB for the guide) because
   every page is fully expanded — expected and fine for static hosting; gzip
   recovers most of it.

## Files

- `packages/lib/src/lib/build-runner.ts` — `paginateToStaticHtml()`,
  `stripPaginationRuntime()`, `injectNavigationScripts()`, rewritten HTML branch.
