import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";
import type MarkdownIt from "markdown-it";

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
      pluginModule = await import(config.name);
      pluginName = config.name;
    } else {
      throw new Error('Plugin config must specify either path or name');
    }

    // Extract the default export (the plugin function)
    const plugin = pluginModule.default;
    if (typeof plugin !== 'function') {
      throw new Error(`Plugin ${pluginName} does not export a default function`);
    }

    return {
      name: pluginName,
      plugin,
      metadata: pluginModule.metadata,
      css: pluginModule.css,
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
