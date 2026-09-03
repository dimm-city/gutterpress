/**
 * Pure (node-free) markdown rendering core.
 *
 * §1/§8 / ADR 0004: this module imports ONLY pure JS — markdown-it and its
 * plugins, Gutterpress's inlined marker parser (`markers.js`), and the node-free
 * leveled logger (console-only). It contains NO `node:*`,
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
import gutterpressMarkers, { buildDeclaredMarkerRegistry } from "./markers.js";
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
// Gutterpress's own bundled feature (#237), not a wrapped third-party
// package — see gfm-alerts.ts's header for the full design rationale.
import gfmAlerts from "./gfm-alerts";
import { registerImageRule } from "./images";
import { sourceRangeRule } from "./source-range";
import { registerInlineSourceMetadata } from "./inline-source";

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
 * A declared marker's structural-element label (#240) — a real child element
 * injected as the container's first child, the same "structural element
 * carrying the data as both text content and an attribute" shape
 * `markers.js`'s own `.chapter-opener` uses for `@chapter`.
 */
export interface GutterpressMarkerLabel {
  /** Class on the injected label element. */
  class: string;
  /**
   * Where the label text comes from. Only `"attr:<name>"` is supported today
   * (the marker's own attribute of that name) — see `markers.js`'s
   * `resolveContainerShape` for why the format leaves room to grow later
   * instead of silently doing nothing for an unsupported value now.
   */
  from: string;
  /** HTML tag for the injected label element. Defaults to `"div"`. */
  tag?: string;
}

/**
 * One entry in a plugin's declared `markers` table (#240 — "declarative
 * container components in core"). Exactly one of three shapes:
 *
 *   - a CONTAINER: `tag`/`class`/`variants`/`label`/`autoCloseAt`, any/all
 *     optional (a bare `{}` is a valid, if pointless, `<div>` wrapper);
 *   - an ALIAS: `alias` (another declared name) + optional `preset`;
 *   - a DEPRECATION: `deprecated` (a human-readable retirement message) —
 *     wins over every other field on the same entry, per
 *     `markers.js`'s `resolveMarkerDeclaration`.
 *
 * See `markers.js`'s header comment for a worked example and
 * `buildDeclaredMarkerRegistry` for the full validation/resolution contract
 * (collision rules, alias indirection, the auto-derived `@end-<name>`
 * closer). This type exists so a plugin AUTHOR importing it type-only
 * (CLAUDE.md §5) has a real shape to write against; core's own consumption
 * of the data is plain, duck-typed JS, matching every other markdown-it
 * plugin input.
 */
export interface GutterpressMarkerDeclaration {
  /** Wrapper element tag. Defaults to `"div"`. */
  tag?: string;
  /** Base class(es) on the wrapper, e.g. `"dc-alert"`. */
  class?: string;
  /**
   * Extra class(es) keyed by the marker's own bare name/argument (its
   * "variant" — `@callout warning` selects `variants.warning`), appended
   * after `class`.
   */
  variants?: Record<string, string>;
  label?: GutterpressMarkerLabel;
  /**
   * Boundaries at which an unclosed instance of this marker auto-closes
   * WITHOUT a warning. `"eof"` is the only value implemented today — an
   * unclosed container always auto-closes at end-of-document regardless
   * (required for well-formed HTML across concatenated chapter files); this
   * only controls whether that forced close is silent (declare it here) or
   * warns (the default — most likely a forgotten `@end-<name>`).
   */
  autoCloseAt?: Array<"eof">;
  /** This marker is sugar for another declared marker (must name a non-alias, non-deprecated entry). */
  alias?: string;
  /** With `alias`: defaults applied when the invocation line supplies none. */
  preset?: { variant?: string };
  /** This marker is retired: using it (or its `@end-` form) warns with this message and is otherwise a no-op. */
  deprecated?: string;
}

/** A plugin's full declared marker table — see {@link GutterpressMarkerDeclaration}. */
export type GutterpressMarkerTable = Record<string, GutterpressMarkerDeclaration>;

/**
 * Full shape a plugin module may export. Only `default` is required.
 *
 * ```ts
 * const plugin: GutterpressPlugin = (md) => { ... };
 * export default plugin;
 * export const metadata: GutterpressPluginMetadata = { name: 'my-plugin', version: '1.0.0' };
 * export const css = `.my-class { color: red; }`;
 * export const styles = ["./styles/components.css", "./styles/callouts.css"];
 * export const markers: GutterpressMarkerTable = { callout: { tag: 'div', class: 'dc-alert' } };
 * ```
 */
export interface GutterpressPluginExport {
  default: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  /** CSS injected into <head> after user stylesheets. Use sparingly — has equal cascade specificity. */
  css?: string;
  /**
   * File-based plugin CSS (#238), as paths RELATIVE TO THIS MODULE — resolved
   * by the node-coupled loader (`plugins.ts`), never by this pure module. Each
   * file enters the SAME pipeline a manifest `styles:` entry does: asset-
   * inlined (fonts/images embedded, local `@import` followed) and print-safety
   * lintable — unlike `css`, which is an opaque string no other subsystem can
   * see. Kept alongside `css` (not a replacement) for one-liners that don't
   * warrant a separate file. Cascade position matches `css`'s: after core,
   * before the project's own stylesheets.
   */
  styles?: string[];
  /**
   * Declarative container components (#240) — data interpreted by CORE's
   * marker parser (`markers.js`), the same relationship `css`/`styles`
   * already have to the loader. See {@link GutterpressMarkerDeclaration}.
   */
  markers?: GutterpressMarkerTable;
}

/** Internal representation of a loaded plugin, ready for `md.use()`. */
export interface LoadedPlugin {
  name: string;
  plugin: GutterpressPlugin;
  metadata?: GutterpressPluginMetadata;
  css?: string;
  /**
   * #238 — UNLIKE `GutterpressPluginExport.styles` (author-declared, relative
   * to the plugin module), this is already resolved to ABSOLUTE filesystem
   * paths by the loader (`plugins.ts`'s `loadPlugin`), in the plugin's own
   * declared order. `undefined`/`[]` for a plugin that declares none.
   */
  styles?: string[];
  /** #240 — the plugin's raw, as-authored `markers` export, unresolved (see
   * {@link GutterpressPluginExport.markers}). `createMarkdownRenderer` merges
   * every loaded plugin's table via `buildDeclaredMarkerRegistry` before
   * `gutterpressMarkers` ever runs — this field is untouched by the loader,
   * mirroring how `css` is carried through as an opaque string. */
  markers?: GutterpressMarkerTable;
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
 *
 * `gutterpress-gfm-alerts` (#237) is keyed differently from its four
 * siblings: it is not a real npm package, it is Gutterpress's OWN code
 * (gfm-alerts.ts) registered under a name that reads like one, matching the
 * shape "keyed by npm name" is written for. There is nothing to install
 * either way — the lookup below always wins before any npm resolution is
 * attempted (`plugins.ts`'s `loadPlugin`) — so a real npm package never
 * existing under this exact name costs nothing.
 */
export const BUILTIN_OPTIONAL_PLUGINS: Record<string, GutterpressPlugin> = {
  "markdown-it-mark": unwrapPlugin(markdownItMark) as GutterpressPlugin,
  "markdown-it-sub": unwrapPlugin(markdownItSub) as GutterpressPlugin,
  "markdown-it-sup": unwrapPlugin(markdownItSup) as GutterpressPlugin,
  "markdown-it-abbr": unwrapPlugin(markdownItAbbr) as GutterpressPlugin,
  "gutterpress-gfm-alerts": gfmAlerts,
};

/**
 * Create a fully-configured MarkdownIt instance.
 *
 * Built-in pipeline (runs before any user plugins):
 *   markdown-it-attrs → markdown-it-footnote → markdown-it-deflist →
 *   markdown-it-source-map → Gutterpress markers
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
 * were DC-branded — core should not leak DC identifiers. #237 (0.10.7)
 * restored a core-owned, unbranded equivalent as an OPT-IN bundled feature —
 * `gfm-alerts.ts`, registered below as `gutterpress-gfm-alerts` — emitting
 * only the standard GitHub five (NOTE/TIP/IMPORTANT/WARNING/CAUTION) as
 * neutral `gp-alert`/`gp-alert-<type>` structure (see that file's header).
 * This does not re-converge with the DC plugin: DC's branded extra types
 * (`[!DM]`/`[!VIBE]`/`[!ORIGIN]`, etc.) and its own class names stay exactly
 * where they were moved to, layered on top of (or independent from) this
 * primitive. A project using neither plugin still renders `> [!NOTE]` as a
 * literal blockquote, unchanged — this feature is opt-in, not a default.
 *
 * #240 — before `gutterpressMarkers` is applied, every loaded plugin's
 * declared `markers` table (if any) is merged into ONE registry via
 * `buildDeclaredMarkerRegistry` (markers.js) — validating collisions against
 * core's own reserved names and against each other, resolving alias/preset
 * indirection — and handed to the marker plugin as
 * `{ declaredMarkers }`. This is WHY the merge happens here rather than in
 * the loader (`plugins.ts`): `createMarkdownRenderer` is the one place that
 * already sees every loaded plugin together, and merging before
 * `md.use(gutterpressMarkers, ...)` is what lets `@callout`/`@end-callout`
 * be recognized by the SAME block-level grammar as `@section` from the very
 * first parse, rather than needing a second pass. A plugin's own hand-
 * written block rule (for authors who need more than the declarative table)
 * is still registered later, in the customPlugins loop below, exactly as
 * before #240 — declaring `markers` and writing a plain markdown-it plugin
 * function are not mutually exclusive.
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
  // defensively via the shared helper. `markers.js` is Gutterpress's own ESM
  // file (§6) with a real `export default`, so it needs no unwrap.
  md.use(unwrapPlugin(markdownItAttrs));
  md.use(unwrapPlugin(markdownItFootnote));
  md.use(unwrapPlugin(markdownItDeflist));
  md.use(unwrapPlugin(markdownItSourceMap));
  const declaredMarkerSources = (customPlugins ?? [])
    .filter((p) => !!p.markers)
    .map((p) => ({ pluginName: p.name, markers: p.markers! }));
  const declaredMarkers = buildDeclaredMarkerRegistry(declaredMarkerSources);
  md.use(gutterpressMarkers, { declaredMarkers });
  // This diagnostic must follow the Gutterpress marker parser (it walks the
  // layout_* tokens that parser emits) and markdown-it-attrs (it reads the
  // {.gp-pin} classes attrs attaches).
  md.use(gpPinScope);

  // Image src normalization (token-level renderer rule).
  registerImageRule(md);

  // Apply custom plugins from manifest
  if (customPlugins && customPlugins.length > 0) {
    applyPlugins(md, customPlugins);
  }

  // The parser that recognized an inline image/link records its exact source
  // token for desktop menu edits. This must wrap the final rules after custom
  // plugins; consumers never need a second Markdown parser.
  registerInlineSourceMetadata(md);

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

/**
 * Collect every plugin-declared stylesheet PATH (#238), flattened in plugin
 * load order (a plugin's own files keep their declared order). These are
 * already-resolved ABSOLUTE filesystem paths — `plugins.ts`'s loader resolves
 * them before a `LoadedPlugin` exists, so this stays a pure list operation
 * with no `node:*` needed, matching {@link collectPluginCss}. The caller feeds
 * the result through the SAME asset-inline pipeline a manifest `styles:` list
 * gets (see `lib/markdown/index.ts`'s `renderChapters`), which is where the
 * files are actually read.
 */
export function collectPluginStylePaths(plugins: LoadedPlugin[]): string[] {
  return plugins.flatMap((p) => p.styles ?? []);
}
