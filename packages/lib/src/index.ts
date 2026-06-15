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

// ── Platform abstraction contract (#41) — consumed by the viewer ─────────────
export type { PlatformAdapter, FileStat, FileWriteResult } from "./platform.ts";

// ── Image inspection (#47) — backs the viewer's Media panel detail view ──────
// Dependency-free header parser (PNG/JPEG/TIFF): width/height, DPI, alpha,
// coarse color space. No ImageMagick/`identify` needed — safe in the packaged
// viewer and the compiled CLI binary alike.
export { inspectImage } from "./lib/image-inspect.ts";
export type { ImageInfo, ColorSpace } from "./lib/image-inspect.ts";

// ── Print-safety CSS checks (#39) — backs the in-app CSS editor gutter ────────
// The viewer's CSS editor runs `checkCss` in the renderer (postcss is pure JS)
// to surface the SAME print-safety findings as the CLI validation pipeline.
export { checkCss } from "./lib/printsafe.ts";
export type { PrintSafeWarning } from "./lib/printsafe.ts";
export {
  ruleRemoteUrls,
  ruleRiskyProps,
  rulePagedjsCrashSelectors,
  ruleSyntax,
} from "./lib/printsafe.ts";

// ── Type-only exports for plugin authors ─────────────────────────────────────
export type {
  PrintMdPlugin,
  PrintMdPluginExport,
  PrintMdPluginMetadata,
} from "./lib/markdown/plugins.ts";
