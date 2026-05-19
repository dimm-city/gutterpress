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

