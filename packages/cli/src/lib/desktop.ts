/**
 * Output filename constants for the build pipeline.
 *
 * Historically this file also emitted "desktop chrome" (toolbar + folder
 * picker + GH clone modal) into the build output so the directory was a
 * self-hostable site. That chrome was removed 2026-05-18 when the desktop
 * was extracted into packages/desktop (Electron + SvelteKit). The CLI build
 * now produces a "naked" book.html with Paged.js polyfill and the
 * preview-interface/bridge scripts injected — no toolbar.
 *
 * Power users who want a hosted UI launch the desktop app or write their
 * own iframe wrapper around book.html.
 */
export const BOOK_HTML_FILENAME = "book.html";
