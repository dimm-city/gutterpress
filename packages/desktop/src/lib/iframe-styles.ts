/**
 * CSS that must be injected INTO the cross-origin preview iframe.
 *
 * Because the SvelteKit toolbar (port A) and the Gutterpress preview server
 * (port B) are on different origins, stylesheet rules defined in the toolbar
 * cannot reach the iframe's DOM. We push them in via the gutterpress:inject-styles
 * postMessage protocol added to preview-bridge.js.
 *
 * Paged.js has been removed (native-only-migration-plan.md Phase 6) — the
 * `.pagedjs_*`-targeting canvas/view-mode/debug sheet this file used to also
 * export was deleted with it (the native viewer's own chrome — zoom, sheet
 * background, view modes, debug guides — lives in decorate.ts + viewer.css
 * instead). Only the one engine-agnostic rule below survives: the preview
 * canvas background, which the native viewer's `<body>` (its `.folio-stage`)
 * still needs pushed in from the toolbar's settings.
 */
export function buildCanvasBackgroundStyles(bg: string): string {
  return `
/* Injected by Gutterpress desktop — the author's preview canvas background. */
html, body { background-color: ${bg} !important; }
`.trim();
}
