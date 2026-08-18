/**
 * gutterpress/render — the PURE, node-free render core.
 *
 * §1/§8 / ADR 0004: this entry deliberately exposes ONLY the browser-safe
 * markdown→HTML→book.html pieces. It transitively imports markdown-it + its
 * plugins, Gutterpress's inlined marker parser (`markers.js`), and pure helpers
 * — and NOTHING from `node:*`/`fs`/`path`/`url`. This is what the desktop's WebAdapter imports
 * (a *value* import that stays PWA-clean), so the in-browser live preview (#33)
 * can render the opened project entirely client-side with no localhost server
 * and no puppeteer.
 *
 * The CLI build path keeps using `renderChapters` / `renderChaptersToFile` from
 * `./lib/markdown/index.ts` (the node wrapper around this same core).
 */
export { assembleBookHtml } from "./lib/markdown/assemble";
export type {
  AssembleBookHtmlOptions,
  ReadText,
} from "./lib/markdown/assemble";

export { createMarkdownRenderer, collectPluginCss, applyPlugins } from "./lib/markdown/renderer";
export type {
  LoadedPlugin,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  GutterpressPluginExport,
} from "./lib/markdown/renderer";

export { MARKER_CSS } from "./lib/markdown/markers.js";

/**
 * Page geometry, for anything that needs to lay content out at the real
 * printed page size without running the paginator.
 *
 * `engine/shared/gcpm-extract.ts` has ZERO imports — it is a self-contained
 * CSS reader — so exposing it here costs the render subpath nothing and is
 * enforced by `scripts/check-render-pure.mjs` like everything else on this
 * entry. The rich-text editor uses `resolvePage()` to size its CSS-paginated
 * columns from the author's own `@page` rules, so the editing surface and the
 * PDF derive their geometry from one source rather than two.
 */
export { extract, resolvePage, mediaPrintBodies } from "./engine/shared/gcpm-extract";
export type {
  BreakDecl,
  GcpmModel,
  PageAssignment,
  PageGeometry,
  PageRule,
} from "./engine/shared/gcpm-extract";

/**
 * LIVE-DOCUMENT pagination — the engine's editing mode (see
 * `engine/viewer/live-document.ts`). Derives a CSS-only pagination
 * stylesheet from the book's own CSS so an editing surface can show real,
 * page-sized boxes without running the fragmenter and without any DOM
 * mutation. This is what the desktop's rich editor renders with; keeping it
 * on this entry keeps the editor and the print path reading page geometry
 * from ONE implementation instead of two that drift.
 */
export {
  MIN_LEGIBLE_SCALE,
  breakMappingCss,
  editorStylesheet,
  namedPageCss,
  namedPageDelta,
  nextEditorSheet,
  paginatedWidth,
  paginationCss,
  scrollContainerCss,
} from "./engine/viewer/live-document";
export type { EditorSheet, PaginateOptions } from "./engine/viewer/live-document";
