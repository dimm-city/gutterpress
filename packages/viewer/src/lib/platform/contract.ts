/**
 * Viewer-facing platform contract (#41).
 *
 * `PlatformAdapter` (the narrow, genuinely host-divergent primitive surface) is
 * the canonical contract and lives in `@dimm-city/print-md`. The viewer adds
 * `HostServices` — the host RPC surface (preview/build/doctor/prefs/updater/
 * dialogs) that is *also* host-divergent (Electron IPC today, HTTP in a future
 * PWA) but is viewer-specific, so it is defined here rather than in the lib.
 *
 * The app consumes `Platform` = `PlatformAdapter & HostServices` via
 * `getPlatform()`. It must NOT touch `window.electron` directly — that access
 * is confined to `electron-adapter.ts`.
 */
import type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  AdoptFolderOptions,
  CreateProjectResult,
} from "@dimm-city/print-md";

// Shared IPC payload types — imported from the single source of truth.
// Both electron/bridge-types.ts and this file reference shared-types.ts,
// so these types cannot drift between the host and renderer sides.
import type {
  UpdaterStatus,
  UpdaterEventPayload,
  AppSettings,
  DeepPartial,
  ProjectState,
  ViewerPrefs as SharedViewerPrefs,
  LeftPanelPrefs,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  ProjectRemoteDiagnosis as SharedProjectRemoteDiagnosis,
  ConflictKind,
  ConflictFileInfo,
  ConflictResolutionChoice,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishIssue,
  PublishOutcomeInfo,
  PublishRunResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  PreviewStartResult,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
} from "./shared-types";

export type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  AdoptFolderOptions,
  CreateProjectResult,
};

// Re-export the shared IPC payload types for consumers of contract.ts.
export type {
  UpdaterStatus,
  UpdaterEventPayload,
  AppSettings,
  DeepPartial,
  ProjectState,
  DeviceCodeInfo,
  RemoteConnection,
  RemoteRepository,
  RemoteBranch,
  RepoBook,
  CloneProgressEvent,
  CloneRepositoryArgs,
  RemoteAccessResult,
  ConflictKind,
  ConflictFileInfo,
  ConflictResolutionChoice,
  SyncOutcome,
  ResolveSyncConflictsArgs,
  ConnectGenericHostArgs,
  HostConnectionInfo,
  PublishProviderCard,
  PublishIssue,
  PublishOutcomeInfo,
  PublishRunResult,
  SnapshotEntry,
  SnapshotPage,
  RestoreVersionResult,
  PreviewStartResult,
  BuildResult,
  ExportProgressEvent,
  UrlPreviewBlockedEvent,
};

// ── Unsaved-changes / recovery types (#44) ────────────────────────────────────
//
// Phase-0 type stubs only — no implementation in this pass. See
// docs/design/issue-44-plan.md.

/** Lifecycle of the in-app editor buffer relative to disk (#44). */
export type EditorBufferPhase = "clean" | "dirty" | "saving" | "error";

/**
 * One pending crash-recovery snapshot (#44), stored under
 * `<userData>/recovery/`. `savedAt` is epoch ms of the snapshot; `baseMtimeMs`
 * is the disk mtime the snapshot was taken against, so launch-time recovery can
 * skip entries the user has since saved or that an external edit superseded.
 */
export interface RecoveryEntry {
  filePath: string;
  recoveryPath: string;
  savedAt: number;
  baseMtimeMs: number;
}

/** Payload of an `onFolderChanged` event (#44) — the changed entry's basename. */
export interface FolderChangedEvent {
  filename: string;
}

/** Result of classifying an opened folder (#12). */
export interface ProjectClassification {
  source: ProjectSource;
  capabilities: ProjectCapabilities;
}

// ── Local version history (#13) ───────────────────────────────────────────────
//
// SnapshotEntry, SnapshotPage, RestoreVersionResult imported from shared-types
// (exported at the top of this file). Defined once, not mirrored.

/** Paging inputs for {@link HostServices.listSnapshotsPage}. */
export interface ListSnapshotsOptions {
  /** Max entries per page (host default: 100). */
  limit?: number;
  /** Continuation cursor: the id of the previous page's LAST entry. */
  before?: string;
}

/**
 * One CSS print-safety warning (#39). Mirrors the lib's `PrintSafeWarning`
 * (packages/cli/src/lib/printsafe.ts) — defined locally so the SPA never imports
 * the lib (and its postcss/node deps) into the renderer bundle.
 */
export interface PrintSafeWarning {
  rule: string;
  severity: "error" | "warning";
  message: string;
  line: number;
  column: number;
}

/**
 * One row in the Problems panel (#28). Mirrors the lib's `CheckResult`
 * (packages/cli/src/checks/types.ts) plus a resolved absolute path — defined
 * locally so the SPA never value-imports the lib (§8 / ADR 0004).
 */
export interface ProblemEntry {
  /** Absolute path of the offending file, when the check reported one. */
  filePath?: string;
  /** Project-relative display path (falls back to the basename). */
  file?: string;
  /** 1-based line number, when known. */
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  /** Originating check id (e.g. "source.links.local-refs"). */
  source: string;
}

// TemplateInfo and SnippetEntry migrated to $lib/api.ts (Phase 2D — tpl/snip server routes).

// ── Plugin manager (#30) ──────────────────────────────────────────────────────
//
// Mirror the lib's plugin-manager types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

/** How a plugin entry is referenced in the manifest. */
export type PluginKind = "local" | "npm";

/** One configured plugin, as surfaced to the manager UI. */
export interface ProjectPluginEntry {
  /** Stable reference: the manifest `path` (local) or `name` (npm). */
  ref: string;
  /** `"local"` (file path) or `"npm"` (package name). */
  kind: PluginKind;
  /** Per-project enable flag (manifest `enabled: false` = disabled). */
  enabled: boolean;
}

/** Result of load-testing one configured plugin. */
export interface PluginValidationResult {
  ref: string;
  kind: PluginKind;
  enabled: boolean;
  /** `true` when the plugin loaded OK (or is disabled and skipped). */
  ok: boolean;
  /** The loader's fail-fast error message when `ok` is `false`. */
  error?: string;
}

/** A curated, informational plugin recommendation (NOT auto-installed). */
export interface RecommendedPlugin {
  name: string;
  /** Short plain-language feature name (the row title; `name` is demoted). */
  label?: string;
  description: string;
  /** print-md ships this plugin — "Add" enables it instantly, no install. */
  builtin?: boolean;
}

// ── Theme manager (#32) ───────────────────────────────────────────────────────
//
// Mirror the lib's theme-manager types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004).

/** Author-friendly metadata for one theme (built-in or project). */
export interface ThemeInfo {
  /** Stable id (a built-in id, or a slug for imported/applied themes). */
  id: string;
  /** Display name. */
  name: string;
  /** Theme author, when known. */
  author?: string;
  /** One-line description. */
  description: string;
  /** `"builtin"` (embedded) or `"project"` (copied into the project). */
  kind: "builtin" | "project";
  /** Optional preview image path relative to the theme folder. */
  preview?: string | null;
}

/** Which theme to apply: a built-in id, or a project theme already on disk. */
export type ApplyThemeTarget =
  | { kind: "builtin"; id: string }
  | { kind: "project"; id: string };

// ── Style resolver (CSS editor; audit B2/G1) ──────────────────────────────────
//
// Mirrors the lib's `ProjectStyle` (packages/cli/src/lib/style-resolver.ts) —
// defined locally so the SPA never value-imports the lib (§8 / ADR 0004).

/** One resolvable project stylesheet surfaced to the CSS-editor picker. */
export interface ProjectStyle {
  /** Absolute path to the `.css` file (the editor's open key). */
  path: string;
  /** Project-relative, "/"-separated display name (e.g. `themes/dark/theme.css`). */
  displayName: string;
  /** True when the stylesheet is in the manifest `styles:` list (the active set). */
  active: boolean;
}

// Mirrors the lib's `StyleToken` (packages/cli/src/lib/style-tokens.ts) —
// defined locally so the SPA never value-imports the lib (§8 / ADR 0004). One
// editable `:root` custom property surfaced to the guided Design panel.
export type StyleTokenKind = "color" | "length" | "text";
export interface StyleToken {
  /** The custom-property name, e.g. `--heading-color`. */
  name: string;
  /** The raw declared value, e.g. `#cc0000` or `1.5rem`. */
  value: string;
  /** Which guided control to render. */
  kind: StyleTokenKind;
  /** Human label derived from the name, e.g. "Heading color". */
  label: string;
  /** For `length`: the numeric part. */
  number?: number;
  /** For `length`: the unit (px, rem, em, …). */
  unit?: string;
}

// ── Host RPC payload shapes ────────────────────────────────────────────────
//
// UpdaterStatus and UpdaterEventPayload are imported from shared-types above
// (exported at the top of this file). UpdaterEvent is an alias for the same type.

/** Alias so existing code referencing UpdaterEvent continues to compile. */
export type UpdaterEvent = UpdaterEventPayload;

export interface UpdaterApi {
  getStatus(): Promise<UpdaterStatus>;
  check(): Promise<UpdaterStatus>;
  /** Download the update found by the last check (phase "available"). */
  download(): Promise<UpdaterStatus>;
  /** Quit and install the downloaded update (restart). */
  applyNow(): Promise<{ applied: boolean; version?: string }>;
  onEvent(cb: (event: UpdaterEvent) => void): () => void;
}

/**
 * A host-neutral reference to a project folder (#49).
 *
 * The app-facing contract deals in `FolderRef`, never raw path strings, so the
 * UI makes no assumptions about path-string semantics. On Electron the `key` is
 * the folder's absolute path; on a future PWA (File System Access API) it will
 * be a serialized FSA handle id. The `displayName` is precomputed by the adapter
 * (the folder basename) so the UI never has to split a path itself.
 */
export interface FolderRef {
  /** Stable key for equality / dedup / persistence. Electron: absolute path. PWA: serialized FSA handle id. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

/**
 * A host-neutral reference to a FILE (#61), analogous to {@link FolderRef}.
 *
 * The app-facing contract returns a `FileRef` from the native file picker
 * instead of a raw path string, so the UI makes no assumptions about path-string
 * semantics. On Electron the `key` is the file's absolute path; on a future PWA
 * (File System Access API) it will be a serialized FSA file-handle id. The
 * `displayName` is precomputed by the adapter (the file basename) so the UI never
 * has to split a path itself.
 */
export interface FileRef {
  /** Stable key for IPC / persistence. Electron: absolute path. PWA: serialized FSA handle id. */
  key: string;
  /** Human-readable basename, precomputed by the adapter. */
  displayName: string;
}

export interface RecentFolderEntry {
  key: string;
  displayName: string;
  title: string;
  openedAt: string;
  exists: boolean;
}

export interface FavoriteEntry {
  key: string;
  displayName: string;
  title: string;
  exists: boolean;
}

// ProjectState and ViewerPrefs are imported from shared-types above
// (re-exported at the top of this file). ViewerPrefs.leftPanel is typed as
// LeftPanelPrefs — both defined in shared-types.ts and re-exported here.

export type { SharedViewerPrefs as ViewerPrefs, LeftPanelPrefs };

/** A print-md project discovered by the background scan (#27). */
export interface DiscoveredProject {
  path: string;
  title: string;
}

// ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────────
//
// DeviceCodeInfo, RemoteConnection, RemoteRepository, RemoteBranch, RepoBook,
// CloneProgressEvent, CloneRepositoryArgs imported from shared-types above
// (re-exported at the top of this file).

// ── Advanced Setup (#14, ADR 0006 D3/D7) ──────────────────────────────────────
//
// RemoteAccessResult and ProjectRemoteDiagnosis imported from shared-types above
// (re-exported at the top of this file). The refined ForgeKind / RemoteGuidanceId
// named aliases below give consumers more semantic type names.

/** Why a remote-access probe failed, in machine-readable form. */
export type RemoteAccessFailureReason =
  | "auth"
  | "not-found"
  | "unreachable"
  | "ssh-unsupported"
  | "tls"
  | "unknown";

/** Recognized forge families, for per-provider guidance copy. */
export type ForgeKind =
  | "github"
  | "gitea"
  | "forgejo"
  | "gitlab"
  | "bitbucket"
  | "azure"
  | "generic";

/** Machine-readable next-step hint the UI maps to author copy. */
export type RemoteGuidanceId =
  | "local-only"
  | "connect-github-to-sync"
  | "https-connect-server"
  | "ready-to-sync"
  | "ssh-use-own-tools";

/** Environment status for the Advanced Setup panel — re-exported from shared-types. */
export type { SharedProjectRemoteDiagnosis as ProjectRemoteDiagnosis };

// ── Auto-sync orchestrator status (transparent sync, §4.4 integration plan) ──
//
// Defined locally here — decoupled from the lib — so the SPA never
// value-imports the lib (§8 / ADR 0004). Main emits `sync:status` events with
// this payload; the renderer drives the ambient status pill from it.

/**
 * Ambient sync state emitted by the host auto-sync orchestrator and surfaced
 * to the renderer via the `onSyncStatus` subscription.
 *
 * States:
 *   idle        — no sync scheduled or needed (local-only project, or auto-sync OFF)
 *   syncing     — commit→fetch→merge→push in flight ("Saving changes…")
 *   synced      — last sync completed and remote is up to date
 *   up-to-date  — sync ran; nothing needed (no local or remote changes)
 *   offline     — network unavailable; changes are saved locally
 *   auth        — credential missing or rejected ("Reconnect your repository")
 *   conflict    — a content conflict needs the author's attention
 *   error       — a transient/unexpected sync failure; treated like offline by the pill
 *   recovering  — automated repair in progress (translucent overlay, non-dismissable)
 *   recovered   — repair completed successfully; overlay auto-dismisses after ~1.8s
 */
export type SyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "up-to-date"
  | "offline"
  | "auth"
  | "conflict"
  | "error"
  | "recovering"
  | "recovered"
  // "local" — a local-git project with no syncable remote. No sync runs, but
  // version history (auto-snapshots) is active; the status pill shows a
  // clickable "Version history on" label that opens the operation log.
  | "local";

// ── Recovery types — defined locally; no lib value import in the SPA ─────────
//
// These mirror the lib's recovery types but are defined here so the SPA never
// needs to value-import @dimm-city/print-md (§8 / ADR 0004). The host
// (electron/main.ts) maps the lib types to these before emitting.

/**
 * Progress information emitted while an automated repair is running.
 * Present on `SyncStatus` when `state === "recovering"`.
 */
export interface RecoveryProgressInfo {
  phase: "checking" | "backup" | "repairing" | "done";
  risk: "none" | "low" | "medium" | "high";
  message?: string;
}

/**
 * Machine token for the primary CTA — the host switches on this to route the
 * guidance dialog's primary button. Local mirror of the lib's
 * `RecoveryActionKey` (no lib value import in the SPA, §8 / ADR 0004).
 */
export type RecoveryActionKey =
  | "sync"
  | "reconnect"
  | "resolve_conflict"
  | "restore_repo"
  | "check_connection";

/**
 * Plain-language guidance shown when a repair is blocked or fails.
 * Local mirror of the lib's `ManualGuidance` — no git jargon in any field
 * except `supportDetails` (which is only shown behind a "Copy details" action).
 */
export interface ManualGuidanceInfo {
  userSummary: string;
  recommendedNextStep: string;
  recommendedAction: string;
  recommendedActionKey: RecoveryActionKey;
  safeNextSteps?: string[];
  supportDetails?: string;
  backupZipPath?: string;
}

/**
 * What a risky-repair confirmation dialog shows the author.
 * Local mirror of the lib's `RepairConfirmation`.
 */
export interface RepairConfirmationInfo {
  repair: string;
  risk: "none" | "low" | "medium" | "high";
  /** Plain-language summary — no git words. */
  summary: string;
  backupZipPath: string;
  willChangeLocalFiles: boolean;
  willChangeGitMetadata: boolean;
  willChangeRemote: boolean;
  canBeUndoneFromBackup: boolean;
}

/**
 * Payload sent from main to the renderer when a risky repair needs the
 * author's approval before proceeding.
 */
export interface RecoveryConfirmRequest {
  requestId: string;
  projectDir: string;
  confirmation: RepairConfirmationInfo;
}

/**
 * Yours/theirs text for the conflict preview disclosure in ConflictChoicesDialog.
 */
export interface ConflictPreview {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
}

/**
 * Payload pushed to the renderer whenever the auto-sync orchestrator's state
 * changes. `projectDir` scopes the event to one open project (the host may
 * manage multiple). `files` is populated only on `"conflict"`.
 */
export interface SyncStatus {
  state: SyncState;
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /**
   * Conflict file list — present (non-empty) only when `state === "conflict"`.
   * Uses `ConflictFileInfo` (defined below) so the shape stays single-sourced
   * and cannot drift from the lib's ConflictFile.kind values.
   */
  files?: ConflictFileInfo[];
  /**
   * ISO-8601 timestamp of the last completed sync attempt, or null when none
   * has run in this session. Lets the pill show "last synced 2 min ago".
   */
  lastSyncAt: string | null;
  /**
   * Recovery progress info — present when `state === "recovering"`.
   * Drives the RecoveryOverlay progress copy.
   */
  recovery?: RecoveryProgressInfo;
  /**
   * Manual guidance — present when `state === "error"` and the failure was
   * classified (not an unexpected throw). Drives the RecoveryGuidanceDialog.
   */
  guidance?: ManualGuidanceInfo;
  /**
   * Absolute path to the backup zip created before the repair attempt, when
   * one was made. Present on `"recovered"` and `"error"` (after a classified
   * failure) so the UI can offer "Show backup".
   */
  backupZipPath?: string;
  /**
   * Absolute path to the operation log file written during the sync/recovery
   * attempt. Present on `"recovered"`, `"error"`, and `"conflict"` states so
   * the UI can offer "View log" for debugging. The log contains timestamped
   * steps (fetch, merge, backup, etc.) but never secrets.
   */
  logFile?: string;
  /** True when the completed sync/recovery changed files in the local worktree. */
  filesChanged?: boolean;
}

// ── Sync (#15 sync phase, ADR 0006 D5) ────────────────────────────────────────
//
// ConflictKind, ConflictFileInfo, ConflictResolutionChoice, SyncOutcome,
// ResolveSyncConflictsArgs, ConnectGenericHostArgs, HostConnectionInfo
// imported from shared-types above (re-exported at the top of this file).

// ── User settings (#45) ──────────────────────────────────────────────────────
//
// AppSettings is imported from shared-types above (re-exported at the top of
// this file). Adding a new setting: add the key + default to DEFAULT_SETTINGS
// AND update shared-types.ts. A matching UI control in SettingsDialog.svelte
// is the only other change needed.

/**
 * Canonical defaults. The single source of truth for the settings schema.
 * The inline `+page.svelte` defaults that used to live as local `$state`
 * (#5a5a5a / two-column / fit-width) now live here.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    spellCheckLanguage: "en-US",
    autoSaveDelay: 2500,
    crashRecovery: true,
  },
  appearance: {
    theme: "system",
    previewBg: "#5a5a5a",
  },
  preview: {
    defaultZoom: "fit-width",
    viewMode: "two-column",
    paneMode: "view",
  },
  versionHistory: {
    autoSnapshot: true,
    autoSnapshotMinutes: 10,
    autoSync: true,      // transparent-sync plan §6: ON by default when canSync
    autoSyncMinutes: 2,  // ~2 min periodic safety cadence
  },
  gitIdentity: {
    authorName: "",
    authorEmail: "",
  },
  advanced: {
    fileWatcherInterval: 300,
    logLevel: "warn",
  },
};

// DeepPartial, PreviewStartResult, BuildResult, ExportProgressEvent,
// UrlPreviewBlockedEvent imported from shared-types above (re-exported at
// the top of this file).

export interface PreviewStartArgs {
  input: FolderRef;
}

export interface BuildArgs {
  input: FolderRef;
  format: "pdf" | "html" | "pdfx";
  out?: string;
  title?: string;
  pdfxFlavor?: string;
  icc?: string;
  manifest?: string;
  stripAnnotations?: boolean;
  skipLint?: boolean;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
}

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

/**
 * Host RPC services. Host-divergent (IPC vs HTTP) but not part of the narrow
 * filesystem/secrets primitive surface, so kept separate from PlatformAdapter.
 */
/** Payload types for the image pick/copy host service (#31). */
export interface ImagePickResult {
  /** Absolute path chosen by the user, or null when cancelled. */
  filePath: string | null;
}

// ── Media panel (#47) ─────────────────────────────────────────────────────────
//
// Mirrors the lib's ImageInfo (packages/cli/src/lib/image-inspect.ts) — defined
// locally so the SPA never value-imports the lib (§8 / ADR 0004).

/** One image file found under the open project folder. */
export interface MediaImageEntry {
  /** File basename ("cover.png"). */
  name: string;
  /** Project-relative path, "/"-separated — also the markdown src to insert. */
  relPath: string;
  /** Absolute path on disk (input to thumbnails / inspection). */
  path: string;
  /** File size in bytes. */
  size: number;
  mtimeMs: number;
}

/** Header-parse result for one image (PNG/JPEG/TIFF). */
export interface MediaImageInfo {
  width: number;
  height: number;
  /** Effective DPI from metadata; 72 when the file carries no density info. */
  xDpi: number;
  yDpi: number;
  hasAlpha: boolean;
  colorSpace: "srgb" | "gray" | "cmyk" | "";
}

/** Detail-view payload: size always; `info` null for unparsed formats (SVG…). */
export interface MediaImageDetails {
  fileSize: number;
  info: MediaImageInfo | null;
}

/**
 * Coarse host capability flags (#49) so the UI can degrade gracefully without
 * branching on `platform === "web"`. Electron returns all-true; the Web adapter
 * returns the conservative set (see WebAdapter.capabilities for the Safari/OPFS
 * rationale).
 */
export interface PlatformCapabilities {
  /** The host can write build output to a real, user-chosen filesystem path. */
  nativeSavePath: boolean;
  /** The host can reveal a file/folder in the OS file manager. */
  showInFolder: boolean;
  /** The host can persist a folder handle across sessions (FSA on PWA). */
  persistentFolderAccess: boolean;
}

export interface HostServices {
  /** Integer IPC-surface version; mirrors DESKTOP_API in electron/preload.ts. */
  readonly apiVersion: number;
  readonly updater: UpdaterApi;

  /**
   * Coarse host capability flags (#49). Lets the UI degrade gracefully
   * (Safari/OPFS) without branching on the platform name. Electron: all-true.
   */
  capabilities(): PlatformCapabilities;

  // savePdf, pickImageFile, copyFile, pickImageFiles migrated to server routes
  // listProjectImages, imageThumbnail, inspectImage migrated to server routes (Phase 2C)
  // openExternal, showInFolder migrated to server routes

  // Lib API / app state
  // getStatus migrated to server route (Phase 2C)
  // app:getLastProject, app:splashStatus, app:rendererReady — migrated to
  // server routes (Phase 2B).

  // listProjectFiles migrated to server route (src/routes/api/fs/list-project-files)
  // checkCss, lintProject migrated to server routes (Phase 2C)

  // app:getViewerPrefs, app:setViewerPrefs, app:getViewerProjectState,
  // app:setViewerProjectState, app:getSettings, app:setSettings,
  // app:getNativeTheme, app:getRecentFolders, app:getFavorites,
  // app:toggleFavorite, app:removeRecent, app:discoverProjects,
  // app:classifyProject, app:createProject, app:adoptFolder
  // — migrated to SvelteKit server routes (Phase 2B).

  // Native (OS) theme (#48) — push channel kept (main→renderer push, not request/reply)
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  // tpl:* and snip:* migrated to server routes (Phase 2D) — removed from HostServices.
  // plugin:*, theme:*, project:listStyles migrated to server routes (Phase 2E) — removed from HostServices.

  // ── Local version history (#13) ───────────────────────────────────────────
  // enableVersionHistory, listSnapshots, listSnapshotsPage, restoreSnapshot
  // — migrated to SvelteKit server routes (src/routes/api/vcs/*).
  /**
   * Save an explicit snapshot of the project's current state. `message` is
   * optional author text; the host substitutes a default when blank. Rejects
   * with a friendly message when nothing has changed since the last snapshot.
   */
  saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;

  // ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────
  // Two-phase connect: `connectGitHubStart` begins the device flow and
  // resolves with the code to show the user; `connectGitHubWait` resolves once
  // the user approves in the browser (the host stores the credential — the
  // renderer only ever sees redacted status). The WebAdapter stubs reject.

  /** Begin the GitHub device flow; resolves with the code/URL to display. */
  connectGitHubStart(): Promise<DeviceCodeInfo>;
  /** Await user approval of the in-flight device flow. */
  connectGitHubWait(): Promise<RemoteConnection>;
  /** Cancel an in-flight device flow (user closed the dialog). */
  connectGitHubCancel(): Promise<{ ok: boolean }>;
  // disconnectGitHub, getRemoteConnection, listRemoteRepositories, listRemoteBranches,
  // listRepoBooks, diagnoseProjectRemote, testRemoteAccess, connectGenericHost,
  // disconnectHost, listHostConnections, forgeTokenUrl — migrated to server routes (Phase 2F).

  /** Download ("clone") a repository into a new local project folder. */
  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  /** Subscribe to clone progress events. Returns an unsubscribe fn. */
  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;

  // ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ───
  //
  // The host auto-sync orchestrator (electron/main.ts) emits `sync:status`
  // events whenever its state machine transitions. The renderer subscribes here
  // to drive the ambient status pill without polling.

  /**
   * Subscribe to ambient sync-status updates from the host orchestrator.
   * The handler fires on every subsequent transition (`syncing`, `synced`,
   * `offline`, `auth`, `conflict`, `recovering`, `recovered`, …). NOTE: there
   * is NO initial replay — a handler that subscribes after a sync has already
   * settled stays uninvoked until the next transition, so callers should render
   * a sensible default (e.g. blank/idle) until the first event. Returns an
   * unsubscribe fn — call it in `onDestroy` to prevent leaks. The WebAdapter
   * stub never emits and returns a no-op unsubscribe.
   */
  onSyncStatus(handler: (status: SyncStatus) => void): () => void;

  // ── Sync recovery seam (Foundation — §8 / ADR 0004) ───────────────────────
  //
  // Recovery runs in the host (main.ts). These three methods are the only
  // recovery-related surface the renderer needs:
  //   1. Receive risky-repair confirmation requests from main.
  //   2. Send the author's answer back to main.
  //   3. Fetch yours/theirs text for the conflict-preview disclosure.
  //
  // All git/lib work stays in main. Credentials never cross this seam.

  /**
   * Subscribe to risky-repair confirmation requests from the host. When the
   * recovery subsystem needs the author to approve a medium/high-risk repair
   * before proceeding, it sends a `RecoveryConfirmRequest` here. The renderer
   * shows `RecoveryConfirmDialog` and calls `respondRecoveryConfirm` with the
   * author's answer. Returns an unsubscribe fn.
   * WebAdapter: returns a no-op unsubscribe (recovery is desktop-only).
   */
  onRecoveryConfirm(handler: (req: RecoveryConfirmRequest) => void): () => void;

  /**
   * Send the author's approval or rejection back to main to unblock a pending
   * risky repair. `requestId` must match the id in the `RecoveryConfirmRequest`.
   * WebAdapter: resolves immediately (no-op).
   */
  respondRecoveryConfirm(requestId: string, approved: boolean): Promise<void>;

  // getConflictPreview — migrated to server route (src/routes/api/sync/get-conflict-preview)

  /**
   * Enable or disable the auto-sync master switch for the current project.
   * Persisted via the host settings store (equivalent to toggling
   * `versionHistory.autoSync` in AppSettings). The WebAdapter stub is a no-op
   * (auto-sync is desktop-only until the PWA lands).
   */
  setAutoSync(enabled: boolean): Promise<void>;

  // syncChanges — migrated to server route (Phase 2F).

  // ── Sync (#15 sync phase, ADR 0006 D5) ─────────────────────────────────────
  /** Apply per-file conflict choices and sync the combined result. */
  resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome>;

  // readLogFile migrated to server route (src/routes/api/log/read)

  // Preview / build
  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  cancelExport(exportId: string): Promise<{ canceled: boolean }>;
  build(args: BuildArgs): Promise<BuildResult>;
  // doctor migrated to server route (Phase 2C)

  // Event subscriptions (return an unsubscribe fn)
  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void;

  // writeRecovery, clearRecovery, listRecovery — migrated to server routes
  // (src/routes/api/recovery/*) via globalThis hooks registered in main.ts.

  // app:setDirtyState — migrated to server route (Phase 2B).

  /**
   * Subscribe to the main process's request to flush before the window closes
   * (#44). The renderer flushes its buffer then signals completion; main waits
   * (with a watchdog) before destroying the window. Returns an unsubscribe fn.
   */
  onFlushBeforeClose(cb: () => void): () => void;
  /**
   * Subscribe to debounced folder-change notifications for the open project
   * (#44), backing external-edit detection. Returns an unsubscribe fn.
   */
  onFolderChanged(cb: (data: FolderChangedEvent) => void): () => void;
}

/**
 * The complete host surface the viewer app consumes through `getPlatform()`.
 *
 * `openFolder` is overridden here (#49) to return a host-neutral `FolderRef`
 * instead of the lib `PlatformAdapter`'s raw `string` path — so the renderer
 * never assumes path-string semantics. The adapter is the translation seam
 * (Electron wraps the picker's path; the future PWA will return an FSA handle
 * ref). Every other `PlatformAdapter` primitive is inherited unchanged.
 */
export interface Platform extends Omit<PlatformAdapter, "openFolder">, HostServices {
  /**
   * Open a native folder picker. Resolves with a {@link FolderRef} (key +
   * precomputed displayName), or null when the user cancels. The Electron
   * adapter wraps the chosen absolute path; the Web adapter is a 0.6.0 stub.
   */
  openFolder(): Promise<FolderRef | null>;

}
// NOTE: reopenFolder was removed from HostServices (no SPA caller in v1).
// The WebAdapter retains its implementation for the FSA permission re-grant
// flow that will be wired up when the PWA ships.

/**
 * The raw `window.electron` bridge shape exposed by `electron/preload.ts`.
 * Differs from `Platform` only in the members the adapter maps/owns: the fs IPC
 * (`openDirectory` → `Platform.openFolder`, `readFile`, `writeFile`), the
 * FolderRef translation seam (`startPreview`/`build` keep raw path strings here;
 * #49), and `capabilities()` (synthesised by the adapter, not an IPC — Omitted
 * so it can't be called on the raw bridge).
 * ONLY `electron-adapter.ts` (and the `Window` global) should reference this —
 * everything else goes through `Platform`.
 */
export interface ElectronBridge
  extends Omit<
    HostServices,
    | "startPreview"
    | "build"
    | "capabilities"
  > {
  openDirectory(): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<FileWriteResult>;
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;
  // #49: the IPC layer keeps raw path-string semantics — the ElectronAdapter is
  // the translation seam that unwraps FolderRef.key back into the string `input`
  // the existing IPC expects.
  startPreview(args: { input: string } & Omit<PreviewStartArgs, "input">): Promise<PreviewStartResult>;
  build(args: { input: string } & Omit<BuildArgs, "input">): Promise<BuildResult>;
  /** Raw fs stat IPC behind `PlatformAdapter.statFile` (#44). */
  statFile(path: string): Promise<FileStat>;
  /**
   * Raw folder-watch IPC behind `PlatformAdapter.watchFolder` (#44). Subscribes
   * to change events for `path` and returns an unsubscribe fn.
   */
  watchFolder(path: string, cb: () => void): () => void;
}
