/**
 * CSS that must be injected INTO the cross-origin preview iframe.
 *
 * Because the SvelteKit toolbar (port A) and the Gutterpress preview server
 * (port B) are on different origins, stylesheet rules defined in the toolbar
 * cannot reach the iframe's DOM. We push them in via the gutterpress:inject-styles
 * postMessage protocol added to preview-bridge.js.
 *
 * The viewer owns its own chrome — zoom, sheet background, view modes, debug
 * guides all live in decorate.ts + viewer.css. The one rule below is the
 * exception: the preview canvas background is an author SETTING held by the
 * toolbar, so it has to be pushed in to the viewer's `<body>` (its
 * `.gp-stage`).
 */
export function buildCanvasBackgroundStyles(bg: string): string {
  return `
/* Injected by Gutterpress desktop — the author's preview canvas background. */
html, body { background-color: ${bg} !important; }
`.trim();
}
