/**
 * Pure (node-free) markdown rendering core.
 *
 * §1/§8 / ADR 0004: this module imports ONLY pure JS — markdown-it and its
 * plugins, the inlined `markdown-it-paged.js`, and the node-free leveled
 * logger (console-only). It contains NO `node:*`,
 * NO `fs`/`path`/`url`, and NO filesystem access, so it can be imported by the
 * browser renderer (the PWA WebAdapter, #33) AND bundled into the
 * `bun build --compile` CLI binary alike.
 *
 * The plugin *author* types and the markdown-it factory live here (not in
 * `plugins.ts`) precisely because `plugins.ts` is the node-coupled plugin
 * *loader* (`node:fs`/`node:path`/`node:url`/`node:module`). Splitting the pure
 * factory out keeps the browser import graph free of node code. `plugins.ts`
 * re-exports these for backward compatibility, so existing callers are
 * unaffected.
 */
import MarkdownIt from "markdown-it";
import { debug } from "../../utils/logger";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItPaged from "./markdown-it-paged.js";
import gpPinScope from "./gp-pin-scope.js";
import markdownItSourceMap from "markdown-it-source-map";
import markdownItDeflist from "markdown-it-deflist";
// Optional, opt-in markdown features. Bundled so they're available WITHOUT any
// install step — enabling one (via the manifest / the desktop's plugin manager)
// resolves it from this registry instead of the project's node_modules. This is
// what makes "add a plugin → it just works, offline" true for non-technical
// authors, and works in the `bun build --compile` binary too (static imports).
import markdownItMark from "markdown-it-mark";
import markdownItSub from "markdown-it-sub";
import markdownItSup from "markdown-it-sup";
import markdownItAbbr from "markdown-it-abbr";
import { registerImageRule } from "./images";
import { sourceRangeRule } from "./source-range";

/**
 * Plugin author API.
 *
 * A gutterpress plugin is a standard markdown-it plugin — any plugin from npm
 * with the signature `(md, options) => void` will work, including the entire
 * markdown-it plugin ecosystem.
 *
 * Authors of *new* plugins can `import type { GutterpressPlugin } from
 * 'gutterpress'` for type-only support; no runtime dependency on
 * gutterpress is required (or recommended).
 */
export type GutterpressPlugin = (
  md: MarkdownIt,
  options?: Record<string, unknown>
) => void;

/**
 * Optional metadata a plugin may export alongside its default plugin function.
 * Surfaced in load-time log lines so users can see which plugins are active.
 */
export interface GutterpressPluginMetadata {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  keywords?: string[];
}

/**
 * Full shape a plugin module may export. Only `default` is required.
 *
 * ```ts
 * const plugin: GutterpressPlugin = (md) => { ... };
 * export default plugin;
 * export const metadata: GutterpressPluginMetadata = { name: 'my-plugin', version: '1.0.0' };
 * export const css = `.my-class { color: red; }`;
 * ```
 */
export interface GutterpressPluginExport {
  default: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  /** CSS injected into <head> after user stylesheets. Use sparingly — has equal cascade specificity. */
  css?: string;
}

/** Internal representation of a loaded plugin, ready for `md.use()`. */
export interface LoadedPlugin {
  name: string;
  plugin: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  css?: string;
  options: Record<string, unknown>;
}

function hasDefaultExport<T>(plugin: T): plugin is T & { default: T } {
  return !!plugin && typeof plugin === "object" && "default" in plugin;
}

/** Unwrap `{ default: fn }` CJS/ESM interop to the plugin function. */
function unwrapPlugin<T>(plugin: T): T {
  return hasDefaultExport(plugin) ? plugin.default : plugin;
}

/**
 * Bundled, opt-in markdown plugins keyed by their npm name. Enabling one of
 * these (manifest `plugins: - <name>` or the desktop's plugin manager) resolves
 * it from HERE — no project install, no network, works offline and in the
 * compiled binary. The plugin loader (`plugins.ts`) consults this map before
 * trying to resolve a package from the project's node_modules, so a
 * non-technical author gets the feature instantly instead of a "not installed"
 * error. (attrs/footnote/deflist are NOT here — they are always-on defaults
 * applied unconditionally below.)
 */
export const BUILTIN_OPTIONAL_PLUGINS: Record<string, GutterpressPlugin> = {
  "markdown-it-mark": unwrapPlugin(markdownItMark) as GutterpressPlugin,
  "markdown-it-sub": unwrapPlugin(markdownItSub) as GutterpressPlugin,
  "markdown-it-sup": unwrapPlugin(markdownItSup) as GutterpressPlugin,
  "markdown-it-abbr": unwrapPlugin(markdownItAbbr) as GutterpressPlugin,
};

/**
 * Create a fully-configured MarkdownIt instance.
 *
 * Built-in pipeline (runs before any user plugins):
 *   markdown-it-attrs → markdown-it-footnote → markdown-it-deflist →
 *   markdown-it-source-map → markdown-it-paged
 *
 * The `source_range` core rule (source-range.ts, `data-source-range`) is
 * registered LAST — after any custom (manifest) plugins — so it always sees
 * the final token stream. It is additive alongside `markdown-it-source-map`'s
 * `data-source-line`, whose coverage (level-0 blocks only) is unchanged.
 *
 * markdown-it-deflist adds the standard (PHP Markdown Extra / Pandoc)
 * definition-list syntax — `Term` / `: definition` — emitting plain
 * `<dl><dt><dd>`. It is not in CommonMark/markdown-it core; this is the
 * canonical markdown-it plugin for it.
 *
 * Block container syntax (`:::name ... :::`) was removed 2026-05-17 in favor
 * of the @marker family. See docs/migrations/2026-05-removing-container-syntax.md
 * for the migration mapping.
 *
 * GFM-style `> [!NOTE]` alerts were also moved into the DC plugin on the
 * same date because the emitted classes (dc-alert, dc-vibe-callout, etc.)
 * are DC-branded. Core should not leak DC identifiers.
 *
 * @param customPlugins - Optional array of custom plugins to load
 */
export function createMarkdownRenderer(customPlugins?: LoadedPlugin[]): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // Some of these third-party plugins ship as `exports.default = fn`
  // (webpack-style CJS with `__esModule: true`). Bun's runtime auto-unwraps
  // `{ default: fn }` to the function in dev mode; the standalone-binary
  // loader does not, so the import surfaces as `{ default: fn }` and
  // `md.use` blows up with "plugin.apply is not a function". Unwrap
  // defensively via the shared helper. `markdown-it-paged.js` is our own
  // ESM file (§6) with a real `export default`, so it needs no unwrap.
  md.use(unwrapPlugin(markdownItAttrs));
  md.use(unwrapPlugin(markdownItFootnote));
  md.use(unwrapPlugin(markdownItDeflist));
  md.use(unwrapPlugin(markdownItSourceMap));
  md.use(markdownItPaged);
  // Gutterpress's own diagnostic; must follow the paged plugin (it walks the
  // layout_* tokens that plugin emits) and markdown-it-attrs (it reads the
  // {.gp-pin} classes attrs attaches).
  md.use(gpPinScope);

  // Image src normalization (token-level renderer rule).
  registerImageRule(md);

  // Apply custom plugins from manifest
  if (customPlugins && customPlugins.length > 0) {
    applyPlugins(md, customPlugins);
  }

  // Source-range annotation (data-source-range) — registered UNCONDITIONALLY
  // after the custom-plugin block above, not inside it: projects with zero
  // custom plugins must still get the rule. `md.core.ruler.push` appends in
  // registration order, so registering last here guarantees this rule sees
  // the final token stream even when a user plugin pushed its own core rule.
  // See docs/inline-editing-plan.md §2.2 / ADR 0009.
  md.core.ruler.push("source_range", sourceRangeRule);

  return md;
}

/**
 * Apply loaded plugins to a markdown-it instance.
 *
 * Throws if a plugin's `(md, options) => void` call itself throws — usually
 * a sign that the plugin is incompatible with this markdown-it version or
 * has a bug in its `apply` phase.
 */
export function applyPlugins(md: MarkdownIt, plugins: LoadedPlugin[]): void {
  for (const { name, plugin, options, metadata } of plugins) {
    try {
      md.use(plugin, options);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to apply plugin "${name}": ${errorMsg}`);
    }
    // Level-gated ON PURPOSE (was an unconditional console.log): this line
    // fires on EVERY render — each preview rebuild, and the browser render
    // path too — so default output stays quiet. `--verbose` (DEBUG level)
    // restores the confirmation line.
    if (metadata?.name) {
      debug(`Loaded plugin: ${metadata.name} v${metadata.version ?? "?"}`);
    } else {
      debug(`Loaded plugin: ${name}`);
    }
  }
}

/**
 * Collect CSS from all loaded plugins, concatenated in load order.
 */
export function collectPluginCss(plugins: LoadedPlugin[]): string {
  return plugins
    .map((p) => p.css)
    .filter((css): css is string => typeof css === "string" && css.length > 0)
    .join("\n\n");
}
