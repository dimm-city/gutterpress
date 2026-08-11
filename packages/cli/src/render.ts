/**
 * gutterpress/render — the PURE, node-free render core.
 *
 * §1/§8 / ADR 0004: this entry deliberately exposes ONLY the browser-safe
 * markdown→HTML→book.html pieces. It transitively imports markdown-it + its
 * plugins, the inlined `markdown-it-paged.js`, and pure helpers — and NOTHING
 * from `node:*`/`fs`/`path`/`url`. This is what the desktop's WebAdapter imports
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

export { PAGED_CSS } from "./lib/markdown/markdown-it-paged.js";
