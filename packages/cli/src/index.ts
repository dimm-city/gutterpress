/**
 * gutterpress — runtime library for Gutterpress.
 *
 * Consumed by:
 *   - packages/cli  (commands import from here; bundled into the CLI binary + npm package)
 *   - packages/desktop (Electron main imports this package at runtime via a
 *     plain dynamic import, behind the typed IPC handlers in
 *     `electron/api/*.ts`; the SvelteKit-served renderer/SPA never imports it)
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

// ── Platform abstraction contract (#41) — consumed by the desktop ────────────
export type { PlatformAdapter, FileStat, FileWriteResult } from "./platform.ts";

// ── Image inspection (#47) — backs the desktop's Media panel detail view ─────
// Dependency-free header parser (PNG/JPEG/TIFF): width/height, DPI, alpha,
// coarse color space. No ImageMagick/`identify` needed — safe in the packaged
// desktop and the compiled CLI binary alike.
export { inspectImage } from "./lib/image-inspect.ts";
export type { ImageInfo, ColorSpace } from "./lib/image-inspect.ts";

// ── Print-safety CSS checks (#39) — backs the in-app CSS editor gutter ────────
// Per CLAUDE.md §8, `checkCss` runs HOST-SIDE ONLY — the desktop's
// `lint:checkCss` IPC handler (`electron/api/lint.ts`) imports it (postcss
// pulls in `node:url` etc., which crashes if bundled into the SPA renderer per
// the 0.4.0-beta.4 incident); the editor's lint gutter calls
// `$lib/lint/lint-capability.ts`'s `checkCss(...)` over that channel, never
// this export directly. Exported here so the CLI's own validation pipeline and
// the desktop's host-side handler share one implementation.
export { checkCss } from "./lib/printsafe.ts";

// Print-quality findings the render produces (native engine). The codes are
// exported so a surface's plain-language label table can be asserted complete
// against them rather than drifting as checks are added — the desktop
// Problems panel does exactly that.
export { BUILD_DIAGNOSTIC_CODES } from "./engine/compiler/build.ts";
export type { BuildDiagnostic, BuildDiagnosticCode } from "./engine/compiler/build.ts";
export type { PrintSafeWarning } from "./lib/printsafe.ts";
export {
  ruleRemoteUrls,
  ruleRiskyProps,
  ruleSyntax,
} from "./lib/printsafe.ts";

// ── Type-only exports for plugin authors ─────────────────────────────────────
export type {
  GutterpressPlugin,
  GutterpressPluginExport,
  GutterpressPluginMetadata,
} from "./lib/markdown/plugins.ts";

// Rich editor (desktop) — the book's CSS layers scoped to the editor document.
export { composeEditorCss, scopeCssToEditor } from "./lib/editor-css.ts";
export type { ComposeEditorCssOptions } from "./lib/editor-css.ts";
export { inlineStyles } from "./lib/asset-inline.ts";
export type { InlineStylesResult } from "./lib/asset-inline.ts";
