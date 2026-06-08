/**
 * Runtime library API for print-md.
 *
 * Consumers (the bundled Electron + SvelteKit viewer, programmatic users)
 * import from `@dimm-city/print-md` and call these functions with the same
 * shape the citty CLI builds from argv — no subprocess, no JSON IPC.
 *
 * Example:
 *   import { runBuild, startPreviewServer } from "@dimm-city/print-md";
 *   const { url, stop } = await startPreviewServer({ input: "./book", installSignalHandlers: false });
 *   await runBuild({ inputDir: "./book", format: "pdf", outDir: "./out", rawArgs: {} });
 */

export {
  runBuild,
  splitOutPath,
  BuildError,
  type BuildFormat,
  type PdfxFlavor,
  type BuildRunnerOptions,
  type BuildRunnerResult,
  type SplitOutPath,
  type PdfRenderer,
  type PdfRenderInput,
} from "../lib/build-runner";

export {
  startPreviewServer,
  type PreviewServerHandle,
  type StartPreviewServerOptions,
} from "../server";

export type { PreviewServerOptions } from "../types";

export {
  loadManifestWithPath,
  resolveConfig,
} from "../lib/manifest";

export type {
  PrintMdManifest,
  ResolvedConfig,
} from "../schema/manifest.types";

export type {
  PrintMdPlugin,
  PrintMdPluginExport,
  PrintMdPluginMetadata,
} from "../lib/markdown/plugins";

export {
  getSystemDiagnostics,
} from "../lib/diagnostics";

export type {
  ToolStatus,
  SystemDiagnostics,
} from "../lib/diagnostics";

export {
  detectProjectSource,
  capabilitiesFor,
} from "../lib/project-source";

export type {
  ProjectSource,
  ProjectCapabilities,
} from "../lib/project-source";

// ── Project scaffolding contract (#25) — type-only until the impl lands ───────
// The scaffold/source-provider FUNCTIONS are intentionally NOT re-exported yet
// (they are `declare`d, bodiless stubs). Only the types ship so the viewer
// wizard, the `print-md new` CLI command, and tests can be typed against them.
export type {
  ProjectTemplateId,
  ProjectVersionHistoryMode,
  CreateProjectOptions,
  CreateProjectResult,
  CreateProjectErrorCode,
  CreateProjectError,
} from "../lib/project-scaffold.ts";

export type {
  SnapshotEntry,
  InitVersionHistoryOptions,
  SnapshotOptions,
  RestoreSnapshotOptions,
  SourceProvider,
} from "../lib/source-provider.ts";
