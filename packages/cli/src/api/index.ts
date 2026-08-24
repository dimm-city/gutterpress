/**
 * Runtime library API for gutterpress.
 *
 * Consumers (the bundled Electron + SvelteKit desktop, programmatic users)
 * import from `gutterpress` and call these functions with the same
 * shape the citty CLI builds from argv — no subprocess, no JSON IPC.
 *
 * Example:
 *   import { runBuild, startPreviewServer } from "gutterpress";
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
  type EngineBrowser,
  type EngineSession,
} from "../lib/build-runner";

// Host implementations of the EngineBrowser/EngineSession contract (the
// desktop's Electron host) share these contract-level values with the CLI's
// own CDP sessions — one definition of "document ready" and one print-quality
// contract, so the hosts cannot drift.
export { DEFAULT_PRINT_OPTS, readyProbeExpr } from "../engine/shared/cdp";

export {
  startPreviewServer,
  type PreviewServerHandle,
  type StartPreviewServerOptions,
} from "../server";

export type { PreviewServerOptions } from "../types";

export {
  loadManifestWithPath,
  resolveConfig,
  MANIFEST_FILENAMES,
  hasProjectManifest,
} from "../lib/manifest";

export type {
  GutterpressManifest,
  ResolvedConfig,
} from "../schema/manifest.types";

export type {
  GutterpressPlugin,
  GutterpressPluginExport,
  GutterpressPluginMetadata,
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
  findEnclosingRepoDir,
  repoSubPath,
  repoRootForSource,
} from "../lib/project-source";

export type {
  ProjectSource,
  ProjectCapabilities,
} from "../lib/project-source";

// ── Project scaffolding (#25) ─────────────────────────────────────────────────
export {
  scaffoldProject,
  adoptFolder,
  slugifyProjectName,
  escapeYamlScalar,
} from "../lib/project-scaffold.ts";

export type {
  ProjectTemplateId,
  ProjectVersionHistoryMode,
  CreateProjectOptions,
  CustomPageOptions,
  AdoptFolderOptions,
  CreateProjectResult,
  CreateProjectErrorCode,
  CreateProjectError,
} from "../lib/project-scaffold.ts";

// ── Presets & publish targets (ADR 0008) ─────────────────────────────────────
// The registries are the single source of truth for pickers (the desktop
// wizard's preset choice, target selectors) and for CLI flag validation.
export { PRESET_IDS, PRESETS } from "../lib/presets.ts";
export type { PresetId, VendorPreset } from "../lib/presets.ts";
export { TARGETS, TARGET_IDS, publishTargetFor } from "../lib/targets.ts";
export type { PublishTarget, TargetOverlay } from "../lib/targets.ts";

// ── Project templates (#29) ───────────────────────────────────────────────────
export {
  listBuiltInTemplates,
  listCustomTemplates,
  saveProjectAsTemplate,
  importTemplateFromFolder,
  BUILT_IN_TEMPLATE_IDS,
} from "../lib/project-templates.ts";
export type {
  TemplateInfo,
  SaveProjectAsTemplateOptions,
} from "../lib/project-templates.ts";

// ── Snippets (#29) ────────────────────────────────────────────────────────────
export {
  extractVariables,
  substituteVariables,
  listSnippets,
  readSnippet,
  saveSnippet,
  deleteSnippet,
  SNIPPETS_DIR,
} from "../lib/snippets.ts";
export type { SnippetEntry } from "../lib/snippets.ts";

// ── Plugin manager (#30) ──────────────────────────────────────────────────────
export {
  listProjectPlugins,
  setPluginEnabled,
  addLocalPlugin,
  addNpmPlugin,
  validateProjectPlugins,
  RECOMMENDED_PLUGINS,
  PLUGINS_DIR,
} from "../lib/plugin-manager.ts";
export type {
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
  PluginKind,
} from "../lib/plugin-manager.ts";

// ── Theme manager (#32) ───────────────────────────────────────────────────────
export {
  listBuiltInThemes,
  resolveBuiltInTheme,
  listProjectThemes,
  getActiveTheme,
  applyTheme,
  importThemeFromFolder,
  importThemeFromUrl,
  readThemeCss,
  removeProjectTheme,
  getPreviousTheme,
  revertTheme,
  BUILT_IN_THEME_IDS,
  THEMES_DIR,
} from "../lib/theme-manager.ts";
export type {
  ThemeInfo,
  ThemeMetadata,
  ResolvedTheme,
  ApplyThemeTarget,
  BuiltInThemeId,
} from "../lib/theme-manager.ts";

// ── Theme package import (#106) — .zip / .css importer ──
// Only importThemeFromFile is part of the public surface (the desktop's
// import-from-file route). The zip/css sub-importers and pure decision helpers
// stay module-private (theme-import.ts exports them for its own unit tests).
export { importThemeFromFile } from "../lib/theme-import.ts";
export type { ThemeImportResult, ThemeImportWarning } from "../lib/theme-import.ts";

// ── Stylesheet resolution (renderer links them; editor edits them — one source) ──
export { listProjectStyles, resolveActiveStyles } from "../lib/style-resolver.ts";
export type { ProjectStyle } from "../lib/style-resolver.ts";

// ── Project configuration view (#PCV) — author-facing manifest field writers ──
export {
  readManifestFields,
  setManifestFields,
  setActiveStyles,
} from "../lib/manifest-config.ts";
export type { ProjectConfigFields } from "../lib/manifest-config.ts";

export {
  providerFor,
  restoreVersionWithBackup,
  isNoChangesError,
  AUTO_SNAPSHOT_MESSAGE,
  RESTORE_BACKUP_MESSAGE,
  HISTORY_PAGE_LIMIT,
} from "../lib/source-provider.ts";

export type {
  ListHistoryOptions,
  HistoryPage,
} from "../lib/source-provider.ts";

// ── Host-timer cadence policy (auto-snapshot / auto-sync delays) ──────────────
export {
  autoSnapshotDelayMs,
  autoSyncDelayMs,
  isGitInternalPath,
  AUTO_SNAPSHOT_MIN_MINUTES,
  AUTO_SNAPSHOT_MAX_MINUTES,
  AUTO_SNAPSHOT_DEFAULT_MINUTES,
  AUTO_SYNC_MIN_MINUTES,
  AUTO_SYNC_MAX_MINUTES,
  AUTO_SYNC_DEFAULT_MINUTES,
} from "../lib/host-policy.ts";

export type {
  AutoSnapshotPolicy,
  AutoSyncPolicy,
} from "../lib/host-policy.ts";

// ── Remote Git: auth, discovery, clone (#15 / ADR 0006) ──────────────────────
export {
  FileTokenStore,
  defaultConfigDir,
  redactCredential,
  extractUrlCredential,
  migrateUrlCredential,
} from "../lib/remote-auth/token-store.ts";

export type {
  HostCredential,
  TokenStore,
  UrlCredentialExtraction,
} from "../lib/remote-auth/token-store.ts";

export {
  GitHubAuthProvider,
  resolveGitHubClientId,
  GITHUB_HOST,
} from "../lib/remote-auth/github-auth.ts";

export type {
  HostCallbacks,
  DeviceCodeInfo,
  GitHubAuthProviderOptions,
} from "../lib/remote-auth/github-auth.ts";

export {
  listGitHubRepositories,
  listGitHubBranches,
  listRepoBooks,
} from "../lib/remote-auth/github-repos.ts";

export type {
  RemoteRepository,
  RemoteBranch,
  RepoBook,
} from "../lib/remote-auth/github-repos.ts";

export {
  cloneRepository,
  readProjectProvenance,
  provenancePath,
  sanitizeCloneFolderName,
} from "../lib/remote-auth/clone.ts";

export type {
  CloneRepositoryOptions,
  CloneRepositoryResult,
  CloneProgressEvent,
  ProjectProvenance,
} from "../lib/remote-auth/clone.ts";

// ── Advanced Setup: diagnostics + generic token flow (#14 / ADR 0006 D3/D7) ──
export {
  testRemoteAccess,
  isSshRemoteUrl,
} from "../lib/remote-auth/test-access.ts";

export type {
  RemoteAccessResult,
  RemoteAccessFailureReason,
  TestRemoteAccessOptions,
} from "../lib/remote-auth/test-access.ts";

export {
  connectGenericHost,
  knownForgeTokenUrl,
  normalizeForgeHost,
} from "../lib/remote-auth/generic-auth.ts";

export type {
  GenericTokenConnectInput,
  GenericAuthOptions,
} from "../lib/remote-auth/generic-auth.ts";

export {
  diagnoseProjectRemote,
  parseRemoteOrigin,
  forgeKindForHost,
} from "../lib/remote-auth/diagnose.ts";

export type {
  ProjectRemoteDiagnosis,
  DiagnoseProjectRemoteOptions,
  RemoteProtocol,
  RemoteGuidanceId,
  ForgeKind,
} from "../lib/remote-auth/diagnose.ts";

// ── Sync (#15 sync phase, ADR 0006 D5) ───────────────────────────────────────
export {
  syncProject,
  pullChanges,
  pushChanges,
  SYNC_SNAPSHOT_MESSAGE,
} from "../lib/remote-auth/sync.ts";

export type {
  SyncOutcome,
  PullOutcome,
  PushOutcome,
  SyncProjectOptions,
  KeptBothFile,
} from "../lib/remote-auth/sync.ts";

export type {
  SnapshotEntry,
  InitVersionHistoryOptions,
  SnapshotOptions,
  RestoreSnapshotOptions,
  RestoreVersionOptions,
  RestoreVersionResult,
  SourceProvider,
} from "../lib/source-provider.ts";

// ── Publish providers (#35) — node-side only; the renderer reaches these
// through the desktop's /api/publish/* server routes. ─────────────────────────
export {
  runPublish,
  resolvePublishRequest,
} from "../lib/publish/run-publish.ts";
export type {
  RunPublishOptions,
  RunPublishResult,
} from "../lib/publish/run-publish.ts";

export {
  listPublishProviders,
  publishProviderFor,
} from "../lib/publish/registry.ts";

export { connectPublishProvider } from "../lib/publish/connect.ts";
export type { ConnectPublishProviderOptions } from "../lib/publish/connect.ts";

export {
  publishConnectionStatus,
  publishCredentialKey,
  listPublishAccounts,
} from "../lib/publish/types.ts";
export type { PublishSavedAccount } from "../lib/publish/types.ts";

export { PublishSelectionsStore } from "../lib/publish/selections.ts";
export type { PublishAccountSelection } from "../lib/publish/selections.ts";

export {
  readPublishSettings,
  setPublishProviderConfig,
} from "../lib/publish/manifest-publish.ts";

export type {
  PublishProvider,
  PublishProviderId,
  PublishProviderInfo,
  PublishProviderKind,
  PublishConfigField,
  PublishArtifact,
  PublishArtifactFormat,
  PublishAuthStatus,
  PublishDeps,
  PublishListingMetadata,
  PublishOutcome,
  PublishProduct,
  PublishProject,
  PublishRequest,
  PreflightIssue,
  CommandRunner,
  CommandResult,
} from "../lib/publish/types.ts";

// ── Repo repair (node-side only; never imported by renderer) ─────────────────
// One automatic pipeline (2026-08-14 simplification): health probe → lock
// sweep → in-place fixes → re-clone with salvage. Working files are never
// touched; every readable commit stays reachable.
export { repairRepo } from "../lib/remote-auth/recovery/repair.ts";
export type { RepairOptions, RepairResult } from "../lib/remote-auth/recovery/repair.ts";
export {
  classifyFromHealth,
  isLikelyRepoCorruption,
  RepoNeedsRecoveryError,
  isRepoNeedsRecoveryError,
  STALE_LOCK_MIN_AGE_MS,
} from "../lib/remote-auth/recovery/classify.ts";
export type { RepairNeed } from "../lib/remote-auth/recovery/classify.ts";
export {
  inspectRepo,
  preflightStructuralReason,
  buildPreflightDiagnostics,
  verifyRepoReadable,
  isUnbornRepo,
} from "../lib/remote-auth/recovery/inspect.ts";
export type { RepoHealth } from "../lib/remote-auth/recovery/types.ts";

// Structured operation logger (node-side only; the SPA never value-imports it).
export { resolveLogger, shortOid } from "../lib/remote-auth/operation-log.ts";
export type { OperationLogger, LogData } from "../lib/remote-auth/operation-log.ts";
