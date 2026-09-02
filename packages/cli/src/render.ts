/**
 * gutterpress/render — the PURE, node-free render core.
 *
 * §1/§8 / ADR 0004: this entry deliberately exposes ONLY the browser-safe
 * markdown→HTML→book.html pieces. It transitively imports markdown-it + its
 * plugins, Gutterpress's inlined marker parser (`markers.js`), and pure helpers
 * — and NOTHING from `node:*`/`fs`/`path`/`url`. The desktop SPA's rich-editor
 * modules (`rich-doc-host-controller`, `caret-token-commands`, `RichEditor`)
 * value-import this subpath in the browser, and a future separate web package
 * would consume it the same way (ADR 0014) — which is why the build compiles it
 * as its own non-split graph and `scripts/check-render-pure.mjs` fails the
 * build if any Node builtin reaches its closure.
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

export { sourceTokenOccurrenceAt, inlineSourceMetaOf } from "./lib/markdown/inline-source";
export type { InlineSourceMeta } from "./lib/markdown/inline-source";

export { createEditorProjection, PROJECTION_SCHEMA_VERSION } from "./lib/markdown/editor-projection";
export type {
  GutterpressProjection,
  ProjectedBlock,
  ProjectedBlockKind,
  ProjectionEditMode,
  GeneratedView,
  ProjectionDiagnostic,
  ProjectionDiagnosticCategory,
  CreateEditorProjectionOptions,
} from "./lib/markdown/editor-projection";
