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
export type PrintMdPlugin = (md: MarkdownIt, options?: Record<string, unknown>) => void;
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
 * Load a single plugin from a file path or npm package.
 *
 * Throws if the plugin cannot be resolved, imported, or doesn't export a
 * valid plugin function. The error message identifies which manifest entry
 * failed so users can find it.
 */
export declare function loadPlugin(config: ResolvedPluginConfig, baseDir: string): Promise<LoadedPlugin>;
/**
 * Load all plugins from the resolved configuration.
 *
 * Fails fast: if any plugin fails to load, the build aborts with the
 * underlying error. Silent skipping was previously the default and made
 * misconfigured manifests very hard to diagnose (markers stopped
 * transforming with no obvious reason).
 */
export declare function loadPlugins(configs: ResolvedPluginConfig[], baseDir: string): Promise<LoadedPlugin[]>;
/**
 * Apply loaded plugins to a markdown-it instance.
 *
 * Throws if a plugin's `(md, options) => void` call itself throws — usually
 * a sign that the plugin is incompatible with this markdown-it version or
 * has a bug in its `apply` phase.
 */
export declare function applyPlugins(md: MarkdownIt, plugins: LoadedPlugin[]): void;
/**
 * Collect CSS from all loaded plugins, concatenated in load order.
 */
export declare function collectPluginCss(plugins: LoadedPlugin[]): string;
