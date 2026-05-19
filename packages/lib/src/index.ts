/**
 * @dimm-city/print-md-lib — runtime library for print-md.
 *
 * Consumed by:
 *   - packages/cli  (commands import from here; bundled into the CLI binary + npm package)
 *   - packages/viewer  (SvelteKit API routes import from here at runtime)
 *
 * Plugin authors use the type-only exports below to type their plugins without
 * taking a runtime dependency on this package.
 */

// ── Public runtime API ───────────────────────────────────────────────────────
export * from "./api/index.ts";

// ── CLI command helpers (used by packages/cli/src/commands/) ─────────────────
export { log } from "./lib/logger.ts";
export { runLint } from "./lib/lint-runner.ts";
export { openPath } from "./lib/open-path.ts";
export { executeAndReport, executeValidation } from "./lib/validation-exec.ts";
export type { ValidationExecutionResult } from "./lib/validation-exec.ts";
export { formatReport } from "./checks/formatter.ts";
export type { OutputFormat } from "./checks/formatter.ts";
export { runChecks } from "./checks/runner.ts";
export { checkToolAvailability, reportMissingTools } from "./checks/tool-check.ts";
export type { CheckContext, CheckResult } from "./checks/types.ts";
export { resolveCheckSelectors, getChecks, getCheckById } from "./checks/registry.ts";
export type { CheckCategory, CheckPhase } from "./checks/types.ts";
export { loadManifest } from "./lib/manifest.ts";

// ── Type-only exports for plugin authors ─────────────────────────────────────
export type {
  PrintMdPlugin,
  PrintMdPluginExport,
  PrintMdPluginMetadata,
} from "./lib/markdown/plugins.ts";
