import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
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
import { BUILTIN_OPTIONAL_PLUGINS } from "./renderer";

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

  throw new Error(
    `Plugin "${packageName}" not found. Install it in your project:\n` +
      `  cd ${baseDir} && bun add ${packageName}\n` +
      `or reference a local file:\n` +
      `  plugins:\n` +
      `    - path: ./plugins/${packageName}.js`
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
 * Load a single plugin from a file path or npm package.
 *
 * Throws if the plugin cannot be resolved, imported, or doesn't export a
 * valid plugin function. The error message identifies which manifest entry
 * failed so users can find it.
 */
export async function loadPlugin(
  config: ResolvedPluginConfig,
  baseDir: string
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

      // Append a timestamp query param so Bun's ESM module cache is bypassed
      // on each hot-reload — without this, edits to plugin files are silently
      // ignored because Bun returns the cached module for the same file URL.
      const fileUrl = pathToFileURL(pluginPath).href + `?v=${Date.now()}`;
      pluginModule = await import(fileUrl);
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

