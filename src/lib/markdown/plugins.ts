import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";
import type MarkdownIt from "markdown-it";

/**
 * Plugin author API.
 *
 * A print-md plugin is a standard markdown-it plugin — any plugin from npm
 * with the signature `(md, options) => void` will work, including the entire
 * markdown-it plugin ecosystem.
 *
 * Authors of *new* plugins can `import type { PrintMdPlugin } from
 * '@dimm-city/print-md'` for type-only support; no runtime dependency on
 * print-md is required (or recommended).
 */
export type PrintMdPlugin = (
  md: MarkdownIt,
  options?: Record<string, unknown>
) => void;

/**
 * Optional metadata a plugin may export alongside its default plugin function.
 * Surfaced in load-time log lines so users can see which plugins are active.
 */
export interface PrintMdPluginMetadata {
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
 * const plugin: PrintMdPlugin = (md) => { ... };
 * export default plugin;
 * export const metadata: PrintMdPluginMetadata = { name: 'my-plugin', version: '1.0.0' };
 * export const css = `.my-class { color: red; }`;
 * ```
 */
export interface PrintMdPluginExport {
  default: PrintMdPlugin;
  metadata?: PrintMdPluginMetadata;
  /** CSS injected into <head> after user stylesheets. Use sparingly — has equal cascade specificity. */
  css?: string;
}

/** Internal representation of a loaded plugin, ready for `md.use()`. */
export interface LoadedPlugin {
  name: string;
  plugin: PrintMdPlugin;
  metadata?: PrintMdPluginMetadata;
  css?: string;
  options: Record<string, unknown>;
}

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
 * Fails fast: if any plugin fails to load, the build aborts with the
 * underlying error. Silent skipping was previously the default and made
 * misconfigured manifests very hard to diagnose (markers stopped
 * transforming with no obvious reason).
 */
export async function loadPlugins(
  configs: ResolvedPluginConfig[],
  baseDir: string
): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];
  for (const config of configs) {
    plugins.push(await loadPlugin(config, baseDir));
  }
  return plugins;
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
    if (metadata?.name) {
      console.log(`Loaded plugin: ${metadata.name} v${metadata.version ?? "?"}`);
    } else {
      console.log(`Loaded plugin: ${name}`);
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
