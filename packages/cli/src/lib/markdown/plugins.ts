import { existsSync, statSync, unlinkSync } from "node:fs";
import { link, unlink } from "node:fs/promises";
import { resolve, join, dirname, basename, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";

// The plugin author API + the markdown-it factory now live in the node-free
// `renderer.ts` so the browser/PWA WebAdapter can import the pure render core
// (#33). This node-coupled module is the plugin *loader* (`node:fs`/`node:path`/
// `node:url`/`node:module`). The types/values are re-exported below so existing
// callers (`import { applyPlugins, ... } from "./plugins"`) are unaffected.
import type {
  PrintMdPlugin,
  PrintMdPluginMetadata,
  LoadedPlugin,
} from "./renderer";
export type {
  PrintMdPlugin,
  PrintMdPluginMetadata,
  PrintMdPluginExport,
  LoadedPlugin,
} from "./renderer";
export { applyPlugins, collectPluginCss } from "./renderer";
import { BUILTIN_OPTIONAL_PLUGINS, collectPluginCss } from "./renderer";

/**
 * Resolve and import an npm plugin package.
 *
 * Resolution order:
 *   1. User's project (manifest directory) — allows local overrides
 *   2. print-md's own dependencies — for built-in plugins
 *
 * Auto-install is intentionally not supported. Users install plugins via
 * their own package manager (`bun add`, `npm install`, etc.) so that builds
 * are reproducible and don't perform unexpected network access.
 */
async function loadNpmPackage(
  packageName: string,
  baseDir: string
): Promise<unknown> {
  // 1. User's project (manifest dir)
  try {
    const manifestRequire = createRequire(join(baseDir, "package.json"));
    const packagePath = manifestRequire.resolve(packageName);
    return await import(pathToFileURL(packagePath).href);
  } catch {
    // Not in user's project — fall through
  }

  // 2. print-md's own dependencies
  try {
    return await import(packageName);
  } catch {
    // Not found — fall through to error
  }

  // A bare filename that already ends in a JS extension but has no path
  // separator (e.g. `my-plugin.js`) doesn't trip isFilePath's separator+
  // extension heuristic (manifest.ts, ARCH finding #57) and so still reaches
  // here as a "package name". Templating the generic `./plugins/<name>.js`
  // suggestion onto a name that ALREADY has an extension produces a mangled
  // `my-plugin.js.js` double-extension path that can never work — suggest
  // the working fix (just add `./`) instead.
  const looksLikeJsFilename = /\.(m?js|cjs)$/i.test(packageName);
  const suggestedPath = looksLikeJsFilename
    ? `./${packageName}`
    : `./plugins/${packageName}.js`;

  throw new Error(
    `Plugin "${packageName}" not found. Install it in your project:\n` +
      `  cd ${baseDir} && bun add ${packageName}\n` +
      `or reference a local file:\n` +
      `  plugins:\n` +
      `    - path: ${suggestedPath}`
  );
}

/**
 * Extract the plugin function from a loaded module, handling the various
 * shapes Node/Bun produce for ESM/CJS interop:
 *
 *   - ESM default export:           module.default
 *   - CJS `module.exports = fn`:    module.default (via interop) or module itself
 *   - Double-wrapped (rare):        module.default.default
 */
function extractPluginExports(
  pluginModule: unknown,
  pluginRef: string
): {
  plugin: PrintMdPlugin;
  metadata?: PrintMdPluginMetadata;
  css?: string;
} {
  const mod = pluginModule as Record<string, unknown>;
  let plugin: PrintMdPlugin | undefined;
  let metadata = mod.metadata as PrintMdPluginMetadata | undefined;
  let css = mod.css as string | undefined;

  if (typeof mod.default === "function") {
    plugin = mod.default as PrintMdPlugin;
  } else if (typeof pluginModule === "function") {
    plugin = pluginModule as PrintMdPlugin;
  } else if (
    typeof mod.default === "object" &&
    mod.default !== null &&
    typeof (mod.default as Record<string, unknown>).default === "function"
  ) {
    const inner = mod.default as Record<string, unknown>;
    plugin = inner.default as PrintMdPlugin;
    metadata = (inner.metadata as PrintMdPluginMetadata | undefined) ?? metadata;
    css = (inner.css as string | undefined) ?? css;
  }

  if (typeof plugin !== "function") {
    throw new Error(
      `Plugin "${pluginRef}" does not export a valid plugin function. ` +
        `Expected \`export default function (md, options) { ... }\` ` +
        `or CommonJS \`module.exports = function (md, options) { ... }\`.`
    );
  }

  return { plugin, metadata, css };
}

/**
 * Path-plugin ESM cache — keyed by resolved absolute file path, and only
 * reused while the file's mtime matches the cached entry. Bun/Node never
 * evict ESM module-map entries, so unconditionally busting on every load (the
 * previous `?v=${Date.now()}` behavior) reloaded every path-plugin on every
 * preview render and leaked a fresh module instance forever in the
 * long-lived Electron host (ARCH finding #5). Keying on mtime means an
 * untouched file is served from cache (bounded growth, proportional to
 * distinct plugin paths — not load count) while an edited file is still
 * always reloaded (the stale-plugin bug the original bust existed to fix
 * stays fixed).
 */
interface CachedPathPlugin {
  mtimeMs: number;
  module: unknown;
  /** The hard-linked shadow file this module was loaded from, if any. */
  shadowPath: string | null;
}
const pathPluginCache = new Map<string, CachedPathPlugin>();

/** Test-only: reset the path-plugin cache between test cases. */
export function __resetPathPluginCacheForTests(): void {
  pathPluginCache.clear();
}

// A query string is NOT a reliable cache-buster here: Node keys its ESM
// module registry by the full URL (query included), but Bun's local `file://`
// loader resolves the cache key by REAL PATH and ignores query/hash strings
// entirely — confirmed empirically: neither a `?v=` query nor a symlink
// pointing at the edited file busts it (Bun follows symlinks to their
// realpath before the registry lookup). Since the standalone CLI binary
// (`bun build --compile`, §1) runs on Bun's own embedded runtime for real
// end users of `print-md preview`, a query-only bust would silently never
// take effect there. A hard link IS a distinct realpath (unlike a symlink, it
// has no "target" to resolve through), so importing a same-directory shadow
// hard link named by mtime forces a genuinely fresh module on BOTH runtimes,
// with zero content duplication, while same-directory placement preserves
// the plugin's own relative imports (resolved against the importing
// module's real directory, which the shadow link shares with the original).
const liveShadowPaths = new Set<string>();
let exitCleanupRegistered = false;
function ensureExitCleanupRegistered(): void {
  if (exitCleanupRegistered) return;
  exitCleanupRegistered = true;
  process.on("exit", () => {
    for (const shadowPath of liveShadowPaths) {
      try {
        unlinkSync(shadowPath);
      } catch {
        // best effort — nothing to do if it's already gone
      }
    }
  });
}

function shadowPathFor(pluginPath: string, mtimeMs: number): string {
  const ext = extname(pluginPath);
  const stem = basename(pluginPath, ext);
  const token = String(mtimeMs).replace(/\./g, "-");
  return join(dirname(pluginPath), `.${stem}.pmd-reload-${token}${ext}`);
}

/**
 * Import a file-based plugin module, reusing a previous import when the file
 * is unchanged (resolved path + mtime) and forcing a genuinely fresh import
 * (via a same-directory hard-link shadow file, see above) only when the
 * file's mtime has moved since the last load. The previous shadow link is
 * removed once the new one has loaded successfully.
 */
async function loadCachedPathPluginModule(pluginPath: string): Promise<unknown> {
  const mtimeMs = statSync(pluginPath).mtimeMs;
  const cached = pathPluginCache.get(pluginPath);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.module;
  }

  const shadowPath = shadowPathFor(pluginPath, mtimeMs);
  let pluginModule: unknown;
  let shadowActive = false;
  try {
    await link(pluginPath, shadowPath);
    shadowActive = true;
    ensureExitCleanupRegistered();
    liveShadowPaths.add(shadowPath);
    pluginModule = await import(pathToFileURL(shadowPath).href);
  } catch (error) {
    if (shadowActive) {
      // The shadow link was created but the import itself failed (e.g. a
      // syntax error in the edited plugin) — clean up and propagate the real
      // error rather than silently falling back.
      liveShadowPaths.delete(shadowPath);
      await unlink(shadowPath).catch(() => {});
      throw error;
    }
    // Could not even create the shadow link (read-only directory, or a stale
    // link of the same name left by a crashed prior process) — fall back to
    // a plain, uncached import so the load still succeeds when possible.
    pluginModule = await import(pathToFileURL(pluginPath).href);
  }

  const previousShadow = cached?.shadowPath;
  pathPluginCache.set(pluginPath, {
    mtimeMs,
    module: pluginModule,
    shadowPath: shadowActive ? shadowPath : null,
  });
  if (previousShadow) {
    liveShadowPaths.delete(previousShadow);
    await unlink(previousShadow).catch(() => {});
  }
  return pluginModule;
}

/**
 * Load a single plugin from a file path or npm package.
 *
 * Throws if the plugin cannot be resolved, imported, or doesn't export a
 * valid plugin function. The error message identifies which manifest entry
 * failed so users can find it.
 *
 * Path plugins always go through the mtime cache (see the call below): it is
 * correct in both a one-shot CLI build and the long-lived Electron host that
 * runs `runBuild` in-process, so no caller-selected cache mode is needed.
 */
export async function loadPlugin(
  config: ResolvedPluginConfig,
  baseDir: string,
): Promise<LoadedPlugin> {
  const pluginRef = config.path ?? config.name ?? "(unspecified)";
  let pluginModule: unknown;
  let pluginName: string;

  if (!config.path && !config.name) {
    throw new Error(
      "Plugin manifest entry must specify either `path` or `name`. " +
        "Got an empty plugin config."
    );
  }

  // Built-in opt-in plugins resolve from the bundled registry — no project
  // install, no network, works offline and in the compiled binary. This is the
  // happy path for the viewer's recommended plugins.
  if (!config.path && config.name && BUILTIN_OPTIONAL_PLUGINS[config.name]) {
    return {
      name: config.name,
      plugin: BUILTIN_OPTIONAL_PLUGINS[config.name]!,
      options: config.options,
    };
  }

  try {
    if (config.path) {
      const pluginPath = resolve(baseDir, config.path);

      if (!existsSync(pluginPath)) {
        throw new Error(
          `Plugin file not found: ${pluginPath} ` +
            `(resolved from manifest entry path="${config.path}")`
        );
      }

      // Always route through the mtime cache. A bare
      // `import(pathToFileURL(...).href)` is NOT freshness-safe when the
      // process outlives one build: the viewer runs `runBuild` in-process in
      // the long-lived Electron host (a memoized lib import, never a child
      // process), so a second build/export in the same session would serve the
      // FIRST build's plugin module from Node's ESM registry (which never
      // evicts) — a stale-plugin regression. The mtime cache reloads on any
      // edit and reuses an untouched file, correct in both a one-shot CLI
      // build and the long-lived host.
      pluginModule = await loadCachedPathPluginModule(pluginPath);
      pluginName = config.name ?? config.path;
    } else {
      pluginModule = await loadNpmPackage(config.name!, baseDir);
      pluginName = config.name!;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load plugin "${pluginRef}": ${errorMsg}`);
  }

  const { plugin, metadata, css } = extractPluginExports(pluginModule, pluginRef);

  return {
    name: pluginName,
    plugin,
    metadata,
    css,
    options: config.options,
  };
}

/**
 * Load all plugins from the resolved configuration.
 *
 * Two failure modes, selected by whether `onError` is supplied:
 *
 *   - **Fail-fast (no `onError`)** — the default for build/export/validate. If
 *     any plugin fails to load, the whole operation aborts with the underlying
 *     error. A final artifact must never silently omit author-configured
 *     formatting.
 *   - **Degrade-and-report (`onError` supplied)** — for the LIVE PREVIEW. A
 *     plugin that can't load (e.g. a recommended npm plugin the author enabled
 *     but hasn't installed yet) is skipped, `onError` is invoked with the
 *     offending ref + error, and the rest of the document still renders. This
 *     is NOT silent skipping (the failure mode §5 warns against): the caller
 *     surfaces every skip loudly (preview warns in its log; the Plugins panel
 *     shows the plugin as "Not installed" with fix instructions).
 *
 * Path plugins are loaded through the mtime cache in `loadPlugin` regardless
 * of mode (finding #5): an edited plugin reloads across renders while an
 * unedited one is never re-imported, correct in both a one-shot CLI build and
 * the long-lived Electron host.
 */
export async function loadPlugins(
  configs: ResolvedPluginConfig[],
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  for (const config of configs) {
    if (!onError) {
      plugins.push(await loadPlugin(config, baseDir));
      continue;
    }
    try {
      plugins.push(await loadPlugin(config, baseDir));
    } catch (error) {
      onError(
        config.path ?? config.name ?? "(unspecified)",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
  return plugins;
}

/** Result of {@link loadPluginsWithCss}: loaded plugins ready for `applyPlugins`
 * plus their concatenated CSS ready for injection into the rendered document. */
export interface LoadedPluginsWithCss {
  /** `undefined` (not `[]`) when there were no configs to load — matches the
   * `plugins?:` field the renderer options expect, so callers can pass this
   * straight through without an `?? []` at every call site. */
  plugins: LoadedPlugin[] | undefined;
  pluginCss: string;
}

/**
 * Shared "load plugins -> collect their CSS" preamble (ARCH finding #53).
 * Both real render paths — build/export's fail-fast `renderBook`
 * (build-runner.ts) and the live preview's degrade-and-report
 * `renderPreviewBook` (preview/file-watcher.ts) — did this in lockstep,
 * differing ONLY in whether `onError` was supplied. `onError` presence still
 * selects fail-fast vs degrade-and-report (see {@link loadPlugins}) and the
 * matching path-plugin cache mode; this helper just removes the duplicated
 * wiring around it.
 *
 * A `configs` of `undefined`/empty short-circuits WITHOUT calling
 * `loadPlugins` at all (`plugins: undefined`, `pluginCss: ""`) — matching
 * both call sites' prior behavior of never plugin-loading when the manifest
 * declares no plugins.
 */
export async function loadPluginsWithCss(
  configs: ResolvedPluginConfig[] | undefined | null,
  baseDir: string,
  onError?: (pluginRef: string, error: Error) => void
): Promise<LoadedPluginsWithCss> {
  if (!configs || configs.length === 0) {
    return { plugins: undefined, pluginCss: "" };
  }
  const plugins = await loadPlugins(configs, baseDir, onError);
  return { plugins, pluginCss: collectPluginCss(plugins) };
}

