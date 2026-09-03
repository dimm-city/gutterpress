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
// `.tpl` is the extension-template suffix (see embedded-assets.ts): source
// files that hold `{{PLACEHOLDER}}` text and would be a syntax error — or,
// for `plugin.test.js`, a COLLECTED TEST — under their real names.
declare module "*.tpl" { const path: string; export default path; }

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
declare module "markdown-it-mark" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-sub" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-sup" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
declare module "markdown-it-abbr" {
  import type { PluginSimple } from "markdown-it";
  const plugin: PluginSimple;
  export default plugin;
}
