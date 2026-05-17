declare module "markdown-it-attrs" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginWithOptions;
  export default plugin;
}

declare module "markdown-it-source-map" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const plugin: MarkdownIt.PluginSimple;
  export default plugin;
}

// Bun `with { type: "file" }` imports resolve to a string path at build time,
// but TypeScript does not model the type-attribute. For extensions TS would
// otherwise reject as unknown modules (.css, .ico), declare them globally as
// string-defaulted. Other extensions (.html, .json, .js) have TS-known
// shapes that get cast at the use site via `filePath()` in embedded-assets.
declare module "*.ico" { const path: string; export default path; }
declare module "*.css" { const path: string; export default path; }
