declare module "*.md" {
  const content: string;
  export default content;
}

// `with { type: "file" }` imports resolve to a path string at build time.
// TypeScript doesn't model the type attribute, so declare non-standard
// extensions explicitly. JS and JSON have TS-known shapes and are cast at
// the use site via filePath() in embedded-assets.ts.
declare module "*.ico" { const path: string; export default path; }
declare module "*.css" { const path: string; export default path; }
declare module "*.icc" { const path: string; export default path; }

// These markdown-it plugins ship no type declarations. They follow the
// standard markdown-it plugin signature, so declare them accordingly.
declare module "markdown-it-attrs" {
  import type { PluginWithOptions } from "markdown-it";
  const plugin: PluginWithOptions;
  export default plugin;
}
declare module "markdown-it-footnote" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-source-map" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-deflist" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
