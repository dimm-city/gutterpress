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
  findEnclosingRepoDir,
  repoSubPath,
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
  AdoptFolderOptions,
  CreateProjectResult,
  CreateProjectErrorCode,
  CreateProjectError,
} from "../lib/project-scaffold.ts";

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
  RemoteAuthProvider,
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
  GenericTokenAuthProvider,
  connectGenericHost,
  knownForgeTokenUrl,
  normalizeForgeHost,
} from "../lib/remote-auth/generic-auth.ts";

export type {
  GenericTokenConnectInput,
  GenericHostCallbacks,
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
  resolveConflicts,
  onlineCopyPath,
  SYNC_SNAPSHOT_MESSAGE,
} from "../lib/remote-auth/sync.ts";

export type {
  SyncOutcome,
  PullOutcome,
  PushOutcome,
  SyncProjectOptions,
  ResolveConflictsOptions,
  ConflictFile,
  ConflictKind,
  ConflictResolution,
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

// ── Sync recovery (#15, ADR 0006 D5 — node-side only; never imported by renderer) ──
// The recovery subsystem lives entirely in the host (main process / CLI).
// Import-type is safe in the SPA; value imports must only reach the host.
export {
  recover,
  classifyGitError,
  classifyFromHealth,
  inspectRepo,
  buildRecoveryContext,
  preflightStructuralReason,
  buildPreflightDiagnostics,
  verifyRepoReadable,
  isUnbornRepo,
  RepoNeedsRecoveryError,
  isRepoNeedsRecoveryError,
} from "../lib/remote-auth/recovery/dispatch.ts";

// Structured operation logger (node-side only; the SPA never value-imports it).
// Exposed so the host can write preflight diagnostics to the SAME operation-log
// file the recovery subsystem writes to, in the SAME format.
export { resolveLogger, shortOid } from "../lib/remote-auth/operation-log.ts";
export type { OperationLogger, LogData } from "../lib/remote-auth/operation-log.ts";

export type {
  RecoverFn,
  RecoveryContext,
  RecoveryResult,
  SyncErrorKind,
  RecoveryRisk,
  ManualGuidance,
  RepoHealth,
  RecoveryBackup,
  RepairConfirmation,
  ConfirmationGate,
  FaultInjector,
  FaultPoint,
} from "../lib/remote-auth/recovery/dispatch.ts";
