/**
 * editor-projection.ts (SFE-P3e, Lane A) — the desktop host's plugin-aware
 * rich-editor projection builder.
 *
 * This is the ROOT-CAUSE fix the run's product-owner ruling names directly:
 * `+page.svelte`'s `buildRichProjection` used to call
 * `createEditorProjection(content, { sourceVersion })` with neither `md` nor
 * `trusted`, so the desktop's rich editor could never show a project's own
 * plugin regions. This module is the missing host-side half — given a
 * project directory, it loads that project's manifest and its LOCAL-FILE
 * plugins (see "A CONFIRMED BLOCKER, not a design preference" below for why
 * only local-file plugins) and builds a plugin-aware, trusted projection
 * from them, through the SAME production `createMarkdownRenderer`/
 * `createEditorProjection` the CLI build/preview path uses.
 *
 * PURE ENOUGH TO UNIT TEST DIRECTLY (per the run spec): this module takes
 * plain strings, returns plain data, and never touches `ipcMain` — see
 * `tests/editor/editor-projection-host.test.ts`, which calls
 * {@link buildHostEditorProjection} directly, the exact function
 * `main.ts`'s `api:editorProjection` handler calls. All IPC-boundary
 * concerns (sender validation, argument shape/size/range checks) live in
 * `main.ts` itself, matching the existing `fs:watchFolder` precedent — this
 * module assumes its caller already validated `args`.
 *
 * NO CACHING: per the run's binding decision ("no cache layers, no
 * speculative invalidation machinery"), every call re-resolves the manifest
 * and reloads plugins from scratch. `main.ts` only calls this at the
 * existing `rebuildRichDocHost` points (a file switch or rich-mode entry),
 * never per keystroke, so a full rebuild is the right cost/complexity
 * trade-off here — see this lane's report for why a cache was deliberately
 * NOT added.
 *
 * ## A CONFIRMED BLOCKER, not a design preference — read before changing this file
 *
 * The run specification's premise is that this module should call
 * `packages/cli/src/lib/markdown/plugins.ts`'s `loadPlugins`/
 * `loadPluginsWithCss` — the SAME degrade-and-report loader the live
 * preview uses, including its full npm/vendored-plugin resolution. That
 * function is NOT reachable from `packages/desktop` without editing
 * `packages/cli/**`, which this lane's write ownership forbids. Three
 * independent, empirically-verified reasons, strongest first:
 *
 *   1. `loadPlugins`/`loadPluginsWithCss` are not part of `gutterpress`'s
 *      published surface. `package.json` declares exactly three `exports`
 *      subpaths (`.`, `./api`, `./render`); neither `src/index.ts` nor
 *      `src/api/index.ts` re-exports them. Confirmed directly:
 *      `require.resolve("gutterpress/lib/markdown/plugins")` from
 *      `packages/desktop` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. D11
 *      pre-approves exactly the fix (`gutterpress/plugins` is named in its
 *      subpath list) — but adding it is a `packages/cli/package.json` +
 *      `src/api/index.ts` change, out of this lane's write ownership.
 *   2. A relative TypeScript-source import of `plugins.ts` from this file
 *      WAS tried. It technically resolves and runs, but pulls
 *      `packages/cli/src/lib/markdown/renderer.ts` — which value-imports
 *      several markdown-it-* plugins with no shipped types — into THIS
 *      package's type-check graphs. `bun run typecheck`
 *      (`electron/tsconfig.json`) was recoverable with two narrow additions
 *      (`allowJs` + including `packages/cli/src/markdown-shims.d.ts`,
 *      mirroring what `packages/cli/tsconfig.json` already does for
 *      itself) — but `bun run check`
 *      (`packages/desktop/tsconfig.json`, svelte-check) was NOT: that
 *      program already sets `checkJs: true` for the SPA's own `.js`
 *      interop, and under it `packages/cli/src/lib/markdown/markers.js` and
 *      `gp-pin-scope.js` — plain, untyped `.js` files packages/cli's OWN
 *      looser tsconfig never strict-checks — produced **132 genuine
 *      TypeScript errors** (implicit-any parameters, `Frame` shape
 *      mismatches, an unresolvable `markdown-it/lib/token` import) in code
 *      this lane cannot edit (`packages/cli/**`) to fix. This is not a
 *      one-line accommodation; it is packages/cli's internal, unpublished
 *      module graph failing a DIFFERENT package's stricter compiler
 *      settings.
 *   3. Even with (2) somehow resolved, `packages/cli/dist/`'s build
 *      (`bun build … --splitting`) never emits a stable, individually
 *      importable compiled file for `plugins.ts` — only bundled entry-point
 *      chunks and a `.d.ts` (type-only, no runtime companion) — so a
 *      packaged-app import has nothing stable to resolve at that path
 *      either way.
 *
 * Reimplementing a FULL faithful copy of `loadPlugin`'s resolution chain
 * (built-in registry, vendored-npm receipts, legacy unpinned resolution,
 * the mtime/hard-link reload cache) was rejected too — that is exactly the
 * "second implementation of one authoring concept" G-09/AP-18 forbid, for
 * machinery this module does not need (the fixture this run's deliverable 4
 * specifies is a LOCAL-FILE plugin, and D13/this run add no requirement to
 * support npm-vendored plugins from the rich editor).
 *
 * ## What this module actually does instead
 *
 * {@link loadLocalPlugin} below loads ONLY manifest entries with a `path`
 * (a local file, resolved `resolve(baseDir, path)`, then a plain dynamic
 * `import()` and `default`/`metadata`/`css` extraction) — genuinely no
 * receipt, no vendoring, no network, exactly deliverable 4's finding for
 * local-file plugins. An npm-style entry (`name`, no `path`) is reported as
 * a load failure without attempting any resolution — this module has no
 * vendored/npm resolver of its own, so it does not pretend to; it fails
 * that ONE plugin closed and degrade-and-reports it, exactly like every
 * other load failure. This is DELIBERATELY narrower than `loadPlugin` — see
 * this lane's report for the concrete follow-up recommendation (a
 * `gutterpress/plugins` export, per D11) that would let this file delegate
 * to the real thing instead.
 */
import {
  createEditorProjection,
  createMarkdownRenderer,
  collectPluginCss,
  type GutterpressPlugin,
  type GutterpressPluginExport,
  type GutterpressProjection,
  type LoadedPlugin,
} from "gutterpress/render";
import { loadManifestWithPath, resolveConfig, type ResolvedConfig } from "gutterpress";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

/** One entry of `ResolvedConfig.plugins` (`gutterpress`'s own type — not separately exported, so named structurally here). */
type ResolvedPluginConfigEntry = ResolvedConfig["plugins"][number];

/** One plugin that failed to load, degrade-and-report style (D14 `EDITOR_PLUGIN_LOAD_FAILED`). */
export interface EditorProjectionPluginError {
  /** The manifest entry's own ref — a local path (e.g. `./plugins/foo.js`) or an npm package name, whichever the manifest used. */
  readonly pluginRef: string;
  /** A user-facing message naming why this one plugin was skipped. */
  readonly message: string;
}

export interface EditorProjectionHostResult {
  readonly projection: GutterpressProjection;
  /** Concatenated plugin CSS (load order), ready for the mount's `extraCss` — `""` when no loaded plugin declares any. */
  readonly pluginCss: string;
  /** Every plugin that failed to load. Empty when every configured plugin loaded (or none are configured). */
  readonly pluginErrors: readonly EditorProjectionPluginError[];
}

export interface EditorProjectionHostArgs {
  /** The open project's root directory (where `manifest.yaml` and plugin-relative paths resolve from). */
  readonly projectDir: string;
  /** The document's exact current source. */
  readonly content: string;
  /** The document host's current version, stamped onto the returned projection verbatim (G-11). */
  readonly sourceVersion: number;
}

/**
 * Load ONE local-file plugin — see this file's header "What this module
 * actually does instead". Never throws for an npm-style entry (`name`, no
 * `path`) either; it rejects it the same way as any other load failure so
 * the caller's degrade-and-report loop below treats both uniformly.
 */
async function loadLocalPlugin(config: ResolvedPluginConfigEntry, baseDir: string): Promise<LoadedPlugin> {
  const pluginRef = config.path ?? config.name ?? "(unspecified)";

  if (!config.path) {
    throw new Error(
      `Plugin "${pluginRef}" is an npm-package reference. The desktop rich editor's projection only loads ` +
        "local-file plugins directly (path: ./plugins/....js in the manifest) — install/vendor npm plugins " +
        "through the CLI build or the desktop's Plugins panel first.",
    );
  }

  const pluginPath = resolvePath(baseDir, config.path);
  if (!existsSync(pluginPath)) {
    throw new Error(`Plugin file not found: ${pluginPath} (resolved from manifest entry path="${config.path}")`);
  }

  const mod = (await import(pathToFileURL(pluginPath).href)) as Partial<GutterpressPluginExport>;
  const plugin = config.export
    ? ((mod as Record<string, unknown>)[config.export] as GutterpressPlugin | undefined)
    : mod.default;
  if (typeof plugin !== "function") {
    throw new Error(
      config.export
        ? `Plugin "${pluginRef}" does not export a plugin function named "${config.export}".`
        : `Plugin "${pluginRef}" has no default export function.`,
    );
  }

  return {
    name: config.name ?? config.path,
    plugin,
    metadata: mod.metadata,
    css: mod.css,
    options: config.options,
  };
}

/** Degrade-and-report over every configured plugin (D14 `EDITOR_PLUGIN_LOAD_FAILED`) — a failure is collected, never thrown. */
async function loadPluginsDegradeAndReport(
  configs: readonly ResolvedPluginConfigEntry[],
  baseDir: string,
): Promise<{ plugins: LoadedPlugin[]; pluginErrors: EditorProjectionPluginError[] }> {
  const plugins: LoadedPlugin[] = [];
  const pluginErrors: EditorProjectionPluginError[] = [];
  for (const config of configs) {
    try {
      plugins.push(await loadLocalPlugin(config, baseDir));
    } catch (error) {
      pluginErrors.push({
        pluginRef: config.path ?? config.name ?? "(unspecified)",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { plugins, pluginErrors };
}

/**
 * Build a plugin-aware, trusted editor projection for `args.content`, using
 * `args.projectDir`'s real manifest and its real local-file plugins.
 *
 * Steps:
 *   (a) resolve the manifest's plugin configs (`loadManifestWithPath` + `resolveConfig` — both real, public `gutterpress` exports);
 *   (b) load them degrade-and-report ({@link loadPluginsDegradeAndReport} — see this file's header for why this is not `loadPlugins` itself);
 *   (c) build the plugin-applied `md` the exact way the render path does
 *       (`createMarkdownRenderer(plugins)` — its own signature already takes
 *       loaded plugins directly, so no separate `applyPlugins` call is
 *       needed here — both real, public `gutterpress/render` exports);
 *   (d) return `{ projection, pluginCss, pluginErrors }` — `pluginCss` via
 *       `collectPluginCss` (also a real, public `gutterpress/render`
 *       export), never a second hand-rolled join.
 *
 * Never throws for a plugin load failure (that is exactly what degrade-and-
 * report means) — only for something the caller must treat as a hard
 * failure (e.g. a malformed `manifest.yaml`, surfaced by `loadManifestWithPath`).
 */
export async function buildHostEditorProjection(
  args: EditorProjectionHostArgs,
): Promise<EditorProjectionHostResult> {
  const { manifest, manifestDir } = await loadManifestWithPath(args.projectDir);
  const config = resolveConfig({}, manifest);

  const { plugins, pluginErrors } = await loadPluginsDegradeAndReport(config.plugins, manifestDir);
  const pluginCss = collectPluginCss(plugins);

  const md = createMarkdownRenderer(plugins);
  const projection = createEditorProjection(args.content, {
    sourceVersion: args.sourceVersion,
    md,
    trusted: true,
  });

  return { projection, pluginCss, pluginErrors };
}
