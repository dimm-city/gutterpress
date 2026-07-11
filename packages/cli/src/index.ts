/**
 * @dimm-city/print-md — runtime library for print-md.
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
export { log } from "./utils/logger.ts";
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
export type { ResolvedSelectors } from "./checks/registry.ts";
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
// Per CLAUDE.md §8, `checkCss` runs HOST-SIDE ONLY — the `api/lint/check-css`
// server route imports it (postcss pulls in `node:url` etc., which crashes if
// bundled into the SPA renderer per the 0.4.0-beta.4 incident); the editor's
// lint gutter calls `getPlatform().checkCss(...)` over that route, never this
// export directly. Exported here so the CLI's own validation pipeline and the
// viewer's host-side route share one implementation.
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
