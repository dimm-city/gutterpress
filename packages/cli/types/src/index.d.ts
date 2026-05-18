/**
 * Public type-only API for plugin authors.
 *
 * print-md is a CLI tool, not a library — the runtime is shipped as a
 * standalone binary or invoked via `bun src/cli.ts`. This entrypoint exists
 * so TypeScript plugin authors can `import type` the plugin contract
 * without taking a runtime dependency on print-md itself.
 *
 * Example plugin (TypeScript):
 * ```ts
 * import type { PrintMdPlugin, PrintMdPluginMetadata } from '@dimm-city/print-md';
 *
 * const plugin: PrintMdPlugin = (md, options) => {
 *   md.block.ruler.after('paragraph', 'my-rule', (state, line) => {
 *     // ... markdown-it block rule
 *   });
 * };
 *
 * export default plugin;
 * export const metadata: PrintMdPluginMetadata = {
 *   name: 'my-plugin',
 *   version: '1.0.0',
 * };
 * ```
 */
export type { PrintMdPlugin, PrintMdPluginExport, PrintMdPluginMetadata, } from "./lib/markdown/plugins";
/**
 * Runtime API — see ./api for the full barrel.
 * Consumers may also `import { runBuild } from "@dimm-city/print-md/api"`.
 */
export * from "./api/index";
