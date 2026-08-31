/**
 * gutterpress/plugins — the plugin loader boundary (D11 pre-approved
 * subpath; added in SFE-P3e for its first real consumer, the desktop rich
 * editor's host-side projection builder).
 *
 * Re-exports the SAME degrade-and-report-capable loader the CLI's own
 * build/preview path already uses (`./lib/markdown/plugins.ts`) — receipt-
 * verified vendored npm plugins and local files alike — so a host outside
 * this package can load a project's real plugins instead of reimplementing
 * a narrower duplicate. Deliberately minimal: only the loader entry points
 * and the one type a caller needs to hold their result, not the module's
 * internal resolution machinery.
 */
export { loadPlugins, loadPluginsWithCss } from "./lib/markdown/plugins";
export type { LoadedPluginsWithCss } from "./lib/markdown/plugins";
