/**
 * gutterpress/render — the PURE, node-free render core.
 *
 * §1/§8: this entry deliberately exposes ONLY the browser-safe
 * markdown→HTML→book.html pieces. It transitively imports markdown-it + its
 * plugins, Gutterpress's inlined marker parser (`markers.js`), and pure helpers
 * — and NOTHING from `node:*`/`fs`/`path`/`url`. It has no browser consumer
 * today; it is kept node-free (scripts/check-render-pure.mjs) because any
 * future browser build of the app needs to render a book client-side, and that
 * discipline is far harder to restore than to keep.
 *
 * The CLI build path keeps using `renderChapters` / `renderChaptersToFile` from
 * `./lib/markdown/index.ts` (the node wrapper around this same core).
 */
export { assembleBookHtml } from "./lib/markdown/assemble";
export type {
  AssembleBookHtmlOptions,
  ReadText,
} from "./lib/markdown/assemble";

export { createMarkdownRenderer, collectPluginCss, applyPlugins, layerExtensionCss } from "./lib/markdown/renderer";
export type {
  LoadedPlugin,
  GutterpressPlugin,
  GutterpressPluginMetadata,
  GutterpressPluginExport,
} from "./lib/markdown/renderer";

export { MARKER_CSS, KNOWN_KINDS, parseMarkerLine, markerElementAttributes } from "./lib/markdown/markers.js";

export { sourceTokenOccurrenceAt, inlineSourceMetaOf } from "./lib/markdown/inline-source";
export type { InlineSourceMeta } from "./lib/markdown/inline-source";

export {
  createEditorProjection,
  htmlFragmentNesting,
  PROJECTION_SCHEMA_VERSION,
  RICH_MODE_MAX_CONTENT_BYTES,
} from "./lib/markdown/editor-projection";
export type {
  GutterpressProjection,
  ProjectedBlock,
  ProjectedBlockKind,
  ProjectionEditMode,
  GeneratedView,
  ProjectionDiagnostic,
  ProjectionDiagnosticCategory,
  CreateEditorProjectionOptions,
  HtmlFragmentNesting,
  PluginContainer,
  BlockAnchor,
  BlockAttributes,
  InlineWrapper,
} from "./lib/markdown/editor-projection";
