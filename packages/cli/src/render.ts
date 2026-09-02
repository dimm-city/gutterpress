/**
 * gutterpress/render — the PURE, node-free render core.
 *
 * §1/§8 / ADR 0004: this entry deliberately exposes ONLY the browser-safe
 * markdown→HTML→book.html pieces. It transitively imports markdown-it + its
 * plugins, Gutterpress's inlined marker parser (`markers.js`), and pure helpers
 * — and NOTHING from `node:*`/`fs`/`path`/`url`. The real VALUE importers that
 * make this load-bearing: the desktop SPA's `src/routes/+page.svelte` and
 * `src/lib/editor/caret-token-commands.ts` (browser bundle), the VS Code
 * extension host's `src/project/projection.ts`, and `packages/editor`'s
 * browser test suite (`tests/gutterpress/*.btest.ts`, run under
 * `test:browser`). (`rich-doc-host-controller.svelte.ts` and `RichEditor.svelte`
 * only `import type` from this subpath — erased at build, so they add no
 * runtime weight to the browser bundle.) A future separate web package would
 * consume it the same way (ADR 0015) — which is why the build compiles it
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
