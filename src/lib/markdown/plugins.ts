import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";
import type MarkdownIt from "markdown-it";

// Cache directory for downloaded npm plugins
const PLUGIN_CACHE_DIR = join(tmpdir(), 'print-md-plugins');

/**
 * Ensure the plugin cache directory exists with a package.json
 */
async function ensurePluginCache(): Promise<string> {
  if (!existsSync(PLUGIN_CACHE_DIR)) {
    await mkdir(PLUGIN_CACHE_DIR, { recursive: true });
    // Create a minimal package.json for npm/bun to work with
    await writeFile(
      join(PLUGIN_CACHE_DIR, 'package.json'),
      JSON.stringify({ name: 'print-md-plugin-cache', private: true }, null, 2)
    );
  }
  return PLUGIN_CACHE_DIR;
}

/**
 * Check if a package is installed in the cache directory
 */
function isPackageInstalled(packageName: string): boolean {
  // Handle scoped packages (@org/name)
  const packagePath = join(PLUGIN_CACHE_DIR, 'node_modules', packageName);
  return existsSync(packagePath);
}

/**
 * Install an npm package to the cache directory
 */
async function installPackage(packageName: string, version?: string): Promise<void> {
  await ensurePluginCache();

  const packageSpec = version ? `${packageName}@${version}` : packageName;

  // Detect if we're running in Bun or Node
  const isBun = typeof Bun !== 'undefined';
  const cmd = isBun
    ? `bun add ${packageSpec}`
    : `npm install ${packageSpec} --no-save`;

  try {
    execSync(cmd, {
      cwd: PLUGIN_CACHE_DIR,
      stdio: 'pipe',
      timeout: 60000 // 60 second timeout
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to install package ${packageSpec}: ${errorMsg}`);
  }
}

/**
 * Load an npm package, checking multiple locations:
 * 1. User's project (manifest directory)
 * 2. print-md's own dependencies
 * 3. Plugin cache (auto-install if not found)
 */
async function loadNpmPackage(packageName: string, version?: string, baseDir?: string): Promise<any> {
  // First, try to load from the user's project (manifest directory)
  // This allows local overrides of plugins
  if (baseDir) {
    try {
      const manifestRequire = createRequire(join(baseDir, 'package.json'));
      const packagePath = manifestRequire.resolve(packageName);
      const packageUrl = pathToFileURL(packagePath).href;
      return await import(packageUrl);
    } catch {
      // Package not found in user's project
    }
  }

  // Next, try print-md's own dependencies
  try {
    return await import(packageName);
  } catch {
    // Package not found in print-md's dependencies
  }

  // Finally, use the plugin cache (auto-install if needed)
  if (!isPackageInstalled(packageName)) {
    console.log(`Installing plugin: ${packageName}${version ? `@${version}` : ''}...`);
    await installPackage(packageName, version);
  }

  // Load from cache
  const cacheRequire = createRequire(join(PLUGIN_CACHE_DIR, 'package.json'));
  const packagePath = cacheRequire.resolve(packageName);
  const packageUrl = pathToFileURL(packagePath).href;
  return await import(packageUrl);
}

export interface LoadedPlugin {
  name: string;
  plugin: (md: MarkdownIt, options?: Record<string, unknown>) => void;
  metadata?: {
    name?: string;
    version?: string;
    description?: string;
    author?: string;
    keywords?: string[];
  };
  css?: string;
  options: Record<string, unknown>;
}

/**
 * Load a single plugin from a file path or npm package.
 *
 * @param config - Plugin configuration
 * @param baseDir - Base directory to resolve relative paths from (usually manifest directory)
 * @returns Loaded plugin information
 */
export async function loadPlugin(
  config: ResolvedPluginConfig,
  baseDir: string
): Promise<LoadedPlugin> {
  let pluginModule: any;
  let pluginName: string;

  try {
    if (config.path) {
      // Load from file path
      const pluginPath = resolve(baseDir, config.path);

      if (!existsSync(pluginPath)) {
        throw new Error(`Plugin file not found: ${pluginPath}`);
      }

      // Import the plugin module using file URL
      const fileUrl = pathToFileURL(pluginPath).href;
      pluginModule = await import(fileUrl);
      pluginName = config.name ?? config.path;
    } else if (config.name) {
      // Load from npm package
      // Priority: user's project > print-md deps > auto-install to cache
      pluginModule = await loadNpmPackage(config.name, config.version, baseDir);
      pluginName = config.name;
    } else {
      throw new Error('Plugin config must specify either path or name');
    }

    // Extract the plugin function, handling various module formats:
    // - ESM default export: pluginModule.default
    // - CommonJS module.exports = fn: pluginModule.default (Node/Bun ESM interop)
    // - CommonJS direct: pluginModule itself is a function
    // - Double-wrapped: pluginModule.default.default (rare edge case)
    let plugin: ((md: MarkdownIt, options?: Record<string, unknown>) => void) | undefined;
    let metadata = pluginModule.metadata;
    let css = pluginModule.css;

    if (typeof pluginModule.default === 'function') {
      // Standard ESM default export or CommonJS interop
      plugin = pluginModule.default;
    } else if (typeof pluginModule === 'function') {
      // Direct CommonJS export (module.exports = function)
      plugin = pluginModule;
      // For direct CommonJS, metadata/css won't be on the module
    } else if (typeof pluginModule.default?.default === 'function') {
      // Double-wrapped (rare, but some bundlers do this)
      plugin = pluginModule.default.default;
      metadata = pluginModule.default.metadata ?? metadata;
      css = pluginModule.default.css ?? css;
    }

    if (typeof plugin !== 'function') {
      throw new Error(
        `Plugin ${pluginName} does not export a valid plugin function. ` +
        `Expected a function as default export or module.exports.`
      );
    }

    return {
      name: pluginName,
      plugin,
      metadata,
      css,
      options: config.options,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load plugin ${config.path ?? config.name}: ${errorMsg}`);
  }
}

/**
 * Load all plugins from the resolved configuration.
 *
 * @param configs - Array of plugin configurations (already sorted by priority)
 * @param baseDir - Base directory to resolve relative paths from
 * @returns Array of loaded plugins
 */
export async function loadPlugins(
  configs: ResolvedPluginConfig[],
  baseDir: string
): Promise<LoadedPlugin[]> {
  const plugins: LoadedPlugin[] = [];

  for (const config of configs) {
    try {
      const plugin = await loadPlugin(config, baseDir);
      plugins.push(plugin);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: ${errorMsg}`);
    }
  }

  return plugins;
}

/**
 * Apply loaded plugins to a markdown-it instance.
 *
 * @param md - MarkdownIt instance
 * @param plugins - Array of loaded plugins
 */
export function applyPlugins(md: MarkdownIt, plugins: LoadedPlugin[]): void {
  for (const { name, plugin, options, metadata } of plugins) {
    try {
      md.use(plugin, options);

      if (metadata?.name) {
        console.log(`Loaded plugin: ${metadata.name} v${metadata.version ?? '?'}`);
      } else {
        console.log(`Loaded plugin: ${name}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: Failed to apply plugin ${name}: ${errorMsg}`);
    }
  }
}

/**
 * Collect CSS from all loaded plugins.
 *
 * @param plugins - Array of loaded plugins
 * @returns Combined CSS string from all plugins
 */
export function collectPluginCss(plugins: LoadedPlugin[]): string {
  return plugins
    .map(p => p.css)
    .filter((css): css is string => typeof css === 'string' && css.length > 0)
    .join('\n\n');
}
