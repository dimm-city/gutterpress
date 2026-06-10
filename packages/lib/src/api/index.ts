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

// ── Project scaffolding (#25) ─────────────────────────────────────────────────
export {
  scaffoldProject,
  slugifyProjectName,
  escapeYamlScalar,
} from "../lib/project-scaffold.ts";

export type {
  ProjectTemplateId,
  ProjectVersionHistoryMode,
  CreateProjectOptions,
  CreateProjectResult,
  CreateProjectErrorCode,
  CreateProjectError,
} from "../lib/project-scaffold.ts";

export {
  providerFor,
  restoreVersionWithBackup,
} from "../lib/source-provider.ts";

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
} from "../lib/remote-auth/github-repos.ts";

export type {
  RemoteRepository,
  RemoteBranch,
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

// ── Publish / sync (#15 publish phase, ADR 0006 D5) ──────────────────────────
export {
  publishProject,
  resolveConflicts,
  getPublishStatus,
  onlineCopyPath,
  PUBLISH_SNAPSHOT_MESSAGE,
} from "../lib/remote-auth/publish.ts";

export type {
  PublishOutcome,
  PublishProjectOptions,
  ResolveConflictsOptions,
  PublishStatusOptions,
  PublishStatusResult,
  ConflictFile,
  ConflictKind,
  ConflictResolution,
} from "../lib/remote-auth/publish.ts";

export type {
  SnapshotEntry,
  InitVersionHistoryOptions,
  SnapshotOptions,
  RestoreSnapshotOptions,
  RestoreVersionOptions,
  RestoreVersionResult,
  SourceProvider,
} from "../lib/source-provider.ts";
