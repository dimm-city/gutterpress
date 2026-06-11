/**
 * Viewer-facing platform contract (#41).
 *
 * `PlatformAdapter` (the narrow, genuinely host-divergent primitive surface) is
 * the canonical contract and lives in `@dimm-city/print-md-lib`. The viewer adds
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
  CreateProjectResult,
} from "@dimm-city/print-md-lib";

export type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
  CreateProjectOptions,
  CreateProjectResult,
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
// Mirrors the lib's source-provider types — defined locally so the SPA never
// value-imports the lib (and its isomorphic-git/node deps) into the renderer
// bundle (§8 / ADR 0004).

/** One entry in a project's version history (a Git commit, abstracted). */
export interface SnapshotEntry {
  /** Opaque revision id (a commit SHA for the local provider). */
  id: string;
  /** Author-supplied or auto-generated snapshot message. */
  message: string;
  /** Epoch milliseconds the snapshot was taken. */
  timestamp: number;
  /** Display name recorded for the snapshot author, if any. */
  author?: string;
}

/** One bounded page of version history (mirrors the lib's HistoryPage). */
export interface SnapshotPage {
  entries: SnapshotEntry[];
  /** Older entries exist — pass the last entry's id as `before` to continue. */
  hasMore: boolean;
}

/** Paging inputs for {@link HostServices.listSnapshotsPage}. */
export interface ListSnapshotsOptions {
  /** Max entries per page (host default: 100). */
  limit?: number;
  /** Continuation cursor: the id of the previous page's LAST entry. */
  before?: string;
}

/** Result of a safe restore (#13): backupId is the automatic pre-restore snapshot. */
export interface RestoreVersionResult {
  restoredId: string;
  backupId?: string;
}

/**
 * One CSS print-safety warning (#39). Mirrors the lib's `PrintSafeWarning`
 * (packages/lib/src/lib/printsafe.ts) — defined locally so the SPA never imports
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
 * (packages/lib/src/checks/types.ts) plus a resolved absolute path — defined
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

// ── Host RPC payload shapes (mirror electron/preload.ts + types.d.ts) ─────────

export interface UpdaterStatus {
  currentVersion: string | null;
  stagedVersion: string | null;
  availableVersion: string | null;
  phase: "idle" | "checking" | "downloading" | "staged" | "error";
  lastCheckAt: string | null;
  error: string | null;
}

export type UpdaterEvent =
  | { type: "available"; version: string }
  | { type: "staged"; version: string }
  | { type: "uptodate"; reason?: string }
  | { type: "healthy"; version: string }
  | { type: "rolledback"; version: string }
  | { type: "error"; message: string };

export interface UpdaterApi {
  getStatus(): Promise<UpdaterStatus>;
  check(): Promise<UpdaterStatus>;
  applyNow(): Promise<{ applied: boolean; version?: string }>;
  markReady(): Promise<{ ok: true; pending: boolean; version?: string }>;
  onEvent(cb: (event: UpdaterEvent) => void): () => void;
}

export interface RecentFolderEntry {
  path: string;
  title: string;
  openedAt: string;
  exists: boolean;
}

export interface FavoriteEntry {
  path: string;
  title: string;
  exists: boolean;
}

/**
 * Per-project editor/preview state keyed by folder path (#43).
 *
 * `currentPage` and `viewMode` are live today; the remaining fields are written
 * by the forthcoming in-app editor (#38) / chapter list (#42). They are carried
 * through JSON as dead schema now so #38 can persist them without further
 * main.ts changes.
 */
export interface ProjectState {
  currentPage?: number;
  viewMode?: "single" | "two-column";
  lastChapter?: string;
  sidebarOpen?: boolean;
  cursorLine?: number;
  editorScroll?: number;
  splitPaneRatio?: number;
}

export interface ViewerPrefs {
  lastProjectDir?: string | null;
  /** Chapter-list sidebar open/closed, persisted across sessions (#42). */
  sidebarOpen?: boolean;
  /** @deprecated (#43) migration fallback — read `projectStates[dir]` instead. */
  currentPage?: number;
  /** @deprecated (#43) migration fallback — read `projectStates[dir]` instead. */
  viewMode?: "single" | "two-column";
  recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
  favorites?: Array<{ path: string; title: string }>;
  /** Per-project editor/preview state keyed by folder path (#43). */
  projectStates?: Record<string, ProjectState>;
  /**
   * Root directories scanned by `discoverProjects()` (#27). Defaults to
   * `[~/Documents, ~/Desktop]` in the main process when unset. No Settings UI
   * yet — that belongs to #45.
   */
  projectSearchRoots?: string[];
  /**
   * Last classified source of the open project (#12). A cached hint only — the
   * app always re-classifies on folder open (a user may add/remove `.git`
   * between sessions), so this never overrides a fresh detection.
   */
  projectSource?: ProjectSource;
}

/** A print-md project discovered by the background scan (#27). */
export interface DiscoveredProject {
  path: string;
  title: string;
}

// ── Managed GitHub integration (#15, ADR 0006) ────────────────────────────────
//
// Mirrors the lib's remote-auth types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004). Tokens NEVER reach the renderer:
// `RemoteConnection` is redacted status only.

/** What the UI shows during the GitHub device flow (code + where to enter it). */
export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Redacted connection status for a remote host — never carries the token. */
export interface RemoteConnection {
  connected: boolean;
  username?: string;
  label?: string;
}

/** One repository the user can open from GitHub. */
export interface RemoteRepository {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}

/** One branch of a remote repository. */
export interface RemoteBranch {
  name: string;
}

/** One print-md book found inside a repository (Choose-a-book step). */
export interface RepoBook {
  /** Book folder relative to the repo root, "/"-separated ("" = the root). */
  path: string;
  /** Display name (folder basename; the repo name for the root). */
  name: string;
}

/** Coarse clone progress pushed from the host while a project downloads. */
export interface CloneProgressEvent {
  phase: string;
  loaded: number;
  total?: number;
}

/** Inputs for cloning a repository into a new local project folder. */
export interface CloneRepositoryArgs {
  url: string;
  parentDir: string;
  folderName: string;
  branch?: string;
  owner?: string;
  repo?: string;
  /**
   * Book subfolder to open after the clone (repo-relative, "/"-separated).
   * The whole repository is still downloaded once; the chosen folder opens
   * as the project. Empty/absent opens the repository root.
   */
  subPath?: string;
}

// ── Advanced Setup (#14, ADR 0006 D3/D7) ──────────────────────────────────────
//
// Mirrors the lib's diagnose/test-access/generic-auth types — defined locally
// so the SPA never value-imports the lib (§8 / ADR 0004). Tokens flow renderer
// → host exactly once (connectGenericHost) and never come back.

/** Why a remote-access probe failed, in machine-readable form. */
export type RemoteAccessFailureReason =
  | "auth"
  | "not-found"
  | "unreachable"
  | "ssh-unsupported"
  | "tls"
  | "unknown";

/** Outcome of the explicit "Test Remote Access" probe (a refs listing). */
export type RemoteAccessResult =
  | { ok: true; defaultBranch?: string; refCount: number }
  | { ok: false; reason: RemoteAccessFailureReason; message: string };

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

/** Environment status for the Advanced Setup panel. Local reads only. */
export interface ProjectRemoteDiagnosis {
  classification: ProjectSource;
  /** Sanitized remote URL (no embedded credentials), when one exists. */
  remoteUrl?: string;
  remoteHost?: string;
  remoteProtocol: "https" | "ssh" | "none";
  branch?: string;
  /** A credential for `remoteHost` is stored on this computer. */
  credentialPresent: boolean;
  provider: ForgeKind | null;
  /** Token-settings deep link for recognized non-GitHub forges. */
  tokenSettingsUrl: string | null;
  /** ADR 0006 D4: HTTPS remote + stored credential — the Sync gate. */
  canSync: boolean;
  /**
   * @deprecated Same value as {@link canSync}. Do not use in new code —
   * this field will be removed once all callers have migrated to `canSync`.
   * (Terminology note: the concept formerly called "publish" is now "Sync";
   * the alias keeps its original name for shape stability.)
   */
  canPublishWhenImplemented: boolean;
  guidance: RemoteGuidanceId;
}

// ── Sync (#15 sync phase, ADR 0006 D5) ────────────────────────────────────────
//
// Mirrors the lib's sync types — defined locally so the SPA never
// value-imports the lib (§8 / ADR 0004). Outcomes are returned (not thrown):
// the lib maps every failure to an author-friendly status the dialog renders.

/** Ahead/behind summary for the "N changes to sync" UI. */
export interface SyncStatusInfo {
  hasRemote: boolean;
  branch?: string;
  /** Snapshots not yet online; `null` when there is nothing to compare. */
  ahead: number | null;
  /** Online snapshots not yet on this computer; `null` when unknown. */
  behind: number | null;
  /** Working-tree edits that Sync would snapshot first. */
  hasUnsnapshottedChanges: boolean;
  /** True when the counts include a live check of the online repository. */
  live: boolean;
  /**
   * True when `ahead`/`behind` are lower bounds (the host caps the history
   * walk and shallow clones hide older history) — render counts as "250+".
   */
  approximate: boolean;
}

/** One commit in a sync-preview direction list ("ER Update — 9 hours ago"). */
export interface SyncCommitInfo {
  id: string;
  /** First line of the commit message. */
  message: string;
  author: string;
  /** Unix milliseconds. */
  timestamp: number;
}

/** One direction (incoming or outgoing) of a sync preview. */
export interface SyncDirectionInfo {
  /**
   * Commit count. `null` when unknown — the live check failed and there is
   * no local record of the online tip to compare against.
   */
  count: number | null;
  /** Newest-first commit details (the host caps the list length). */
  commits: SyncCommitInfo[];
  /** True when `count` is a lower bound — render as "250+". */
  approximate: boolean;
}

/**
 * Fetch-only "what would a Sync do?" preview. The host FETCHES the online
 * tip (never merges/pushes/snapshots) and reports both directions plus the
 * working-tree edits a Sync's snapshot step would commit. A failed fetch
 * degrades to local information with a friendly `fetchNotice` — it never
 * rejects for the offline/no-auth case.
 */
export interface SyncPreviewInfo {
  hasRemote: boolean;
  branch?: string;
  /** True when `incoming` reflects a successful live fetch just now. */
  live: boolean;
  /** Friendly notice when the live check failed (offline / rejected token). */
  fetchNotice?: string;
  /** Online commits not on this computer yet (Sync would merge them in). */
  incoming: SyncDirectionInfo;
  /** Local commits not online yet (Sync would send them). */
  outgoing: SyncDirectionInfo;
  /**
   * Working-tree edits Sync's snapshot would commit. Paths are shared-folder-
   * relative (book-scoped for subfolder projects); `sample` is capped.
   */
  changedFiles: { count: number; sample: string[] };
}

/** How one conflicted file differs between the two copies. */
export type ConflictKind = "both-edited" | "you-deleted" | "online-deleted";

/** One file that changed in both the local and the online copy. */
export interface ConflictFileInfo {
  path: string;
  kind: ConflictKind;
}

/** The author's per-file decision (Keep mine / Use online / Keep both). */
export interface ConflictResolutionChoice {
  path: string;
  choice: "mine" | "theirs" | "both";
}

/** Outcome of a sync (or conflict-resolution) attempt. */
export type SyncOutcome =
  | {
      status: "synced";
      message: string;
      snapshotId?: string;
      mergedRemoteChanges: boolean;
    }
  | { status: "up-to-date"; message: string; snapshotId?: string }
  | {
      status: "conflict";
      message: string;
      files: ConflictFileInfo[];
      localId: string;
      remoteId: string;
      snapshotId?: string;
    }
  | { status: "auth"; message: string; snapshotId?: string }
  | { status: "offline"; message: string; snapshotId?: string }
  | { status: "error"; message: string; snapshotId?: string };

/** Inputs for applying the author's conflict choices. */
export interface ResolveSyncConflictsArgs {
  projectDir: string;
  resolutions: ConflictResolutionChoice[];
  /** Echo of the conflict outcome's `localId`. */
  localId: string;
  /** Echo of the conflict outcome's `remoteId`. */
  remoteId: string;
}

/** Inputs for the generic "Connect a Git server" token flow. */
export interface ConnectGenericHostArgs {
  host: string;
  username?: string;
  token: string;
  /** Optional repository URL to validate against (full probe must succeed). */
  repoUrl?: string;
}

/** Redacted stored-connection entry — never carries tokens. */
export interface HostConnectionInfo {
  host: string;
  kind: "github-oauth" | "token";
  username?: string;
  label?: string;
  createdAt: number;
}

// ── User settings (#45) ──────────────────────────────────────────────────────
//
// Persisted, section-organised user preferences. Distinct from `ViewerPrefs`
// (session/per-project state). Stored in `userData/app-settings.json` on desktop
// and `localStorage` on the web PWA.
//
// Adding a new setting requires ONE line: add the key + default to the relevant
// section of `DEFAULT_SETTINGS` (its type is inferred). A matching UI control in
// `SettingsDialog.svelte` is the only other change needed.

export interface AppSettings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    spellCheckLanguage: string;
    autoSaveDelay: number;
    /** Write crash-recovery sidecar snapshots while editing (#44). */
    crashRecovery: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    previewBg: string;
  };
  preview: {
    defaultZoom: string;
    viewMode: "single" | "two-column";
    /**
     * On small/narrow viewports the editor and preview can't sit side by side,
     * so the workspace collapses to a single pane and this picks which one is
     * shown. Ignored above the responsive breakpoint (split layout). (#responsive)
     */
    paneMode: "edit" | "view";
  };
  versionHistory: {
    /**
     * Save automatic snapshots while the author works (RC1-3): the host arms a
     * quiet-period timer on every save and snapshots when edits settle, plus on
     * project close / app quit. Only for projects that already have version
     * history — a plain folder is never auto-initialised. Default ON.
     */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires (floor 5). */
    autoSnapshotMinutes: number;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

/**
 * Canonical defaults. The single source of truth for the settings schema — its
 * shape defines `AppSettings`. The inline `+page.svelte` defaults that used to
 * live as local `$state` (#5a5a5a / two-column / fit-width) now live here.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  editor: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 14,
    lineHeight: 1.6,
    spellCheckLanguage: "en-US",
    autoSaveDelay: 1000,
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
  },
  advanced: {
    fileWatcherInterval: 300,
    logLevel: "warn",
  },
};

/** A recursively-optional view of `T` — used for settings patches. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface PreviewStartArgs {
  input: string;
}

export interface PreviewStartResult {
  url: string;
  port: number;
  input: string;
  title: string | null;
  missingSharedAssets?: string[];
}

export interface BuildArgs {
  input: string;
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

export interface BuildResult {
  exportId?: string;
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
}

export interface ExportProgressEvent {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
}

export interface UrlPreviewBlockedEvent {
  url: string;
  reason: string;
}

/** OS appearance state (#48). Resolved against "system" theme mode. */
export interface NativeThemeState {
  shouldUseDarkColors: boolean;
}

/**
 * Host RPC services. Host-divergent (IPC vs HTTP) but not part of the narrow
 * filesystem/secrets primitive surface, so kept separate from PlatformAdapter.
 */
export interface HostServices {
  /** Integer IPC-surface version; mirrors DESKTOP_API in updater/contract.ts. */
  readonly apiVersion: number;
  readonly updater: UpdaterApi;

  // Dialogs
  savePdf(defaultName?: string): Promise<string | null>;

  // Shell actions
  openExternal(url: string): Promise<void>;
  showInFolder(filePath: string): Promise<void>;

  // Lib API / app state
  getStatus(): Promise<{ ok: boolean; runtime: string; name: string }>;
  getLastProject(): Promise<string | null>;

  // ── Splash coordination ──────────────────────────────────────────────────
  // Push human-readable startup status to the host splash (a no-op on the web,
  // which has no splash window), then signal that the first meaningful screen
  // (a rendered project OR the welcome screen) is ready so the host can reveal
  // the main window and dismiss the splash.
  splashStatus(status?: string, progress?: number, sub?: string): Promise<void>;
  rendererReady(): Promise<void>;

  /**
   * List the top-level `.md` and `.css` files of an opened project directory
   * (#42), each sorted by filename. Shallow by design (subdirectory layouts
   * are not surfaced in v1). `projectDir` must be an absolute path. Backs the
   * chapter-list sidebar. The WebAdapter stub rejects.
   */
  listProjectFiles(projectDir: string): Promise<{ md: string[]; css: string[] }>;

  /**
   * Run the CSS print-safety lint (#39) and return warnings for the editor
   * gutter. Host-side because it is postcss-based and postcss's `node:url`
   * usage cannot bundle into the browser SPA — so the UI calls this instead of
   * importing `checkCss` directly. Same check `print-md validate` uses, so the
   * gutter and CLI never disagree. The WebAdapter stub returns `[]`.
   */
  checkCss(css: string, from?: string): Promise<PrintSafeWarning[]>;

  /**
   * Run the project's pre-build source lint checks (#28) — broken local
   * references, print-safety CSS, markdown/HTML style, accessibility — and
   * return one entry per finding for the Problems panel. Host-side because the
   * check runner is Node code (fs/glob/postcss). All source checks run
   * in-process in the packaged app (no external CLI tools). The WebAdapter
   * stub returns `[]` (lint is non-essential chrome, same as checkCss).
   */
  lintProject(projectDir: string): Promise<ProblemEntry[]>;

  getViewerPrefs(): Promise<ViewerPrefs>;
  setViewerPrefs(patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }>;

  /**
   * Per-project editor/preview state (#43). Reads the bucket keyed by
   * `projectDir`; returns `null` when absent or corrupt (silent fail → the app
   * opens page 1). The WebAdapter stub rejects.
   */
  getViewerProjectState(projectDir: string): Promise<ProjectState | null>;
  /**
   * Merge-patch a project's state bucket (#43), upserting the key. Only writes
   * the project-keyed bucket — never the deprecated top-level page/mode.
   */
  setViewerProjectState(
    projectDir: string,
    patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }>;

  // Native (OS) theme (#48)
  getNativeTheme(): Promise<NativeThemeState>;
  onNativeThemeUpdated(cb: (state: NativeThemeState) => void): () => void;

  getRecentFolders(): Promise<RecentFolderEntry[]>;
  getFavorites(): Promise<FavoriteEntry[]>;
  toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }>;
  removeRecent(folderPath: string): Promise<{ ok: boolean }>;

  /**
   * Background scan (#27) of `projectSearchRoots` for print-md projects
   * (folders containing manifest.yaml/.yml) not already in recents/favorites.
   * Shallow (depth ≤ 3). The WebAdapter stub returns `[]`.
   */
  discoverProjects(): Promise<DiscoveredProject[]>;

  /**
   * Classify an opened folder as `local-folder` / `local-git-folder` (#12) and
   * return its capabilities. The WebAdapter stub rejects. Always called after a
   * preview starts; never relies on the cached `ViewerPrefs.projectSource`.
   */
  classifyProject(path: string): Promise<ProjectClassification>;

  /**
   * Scaffold a new project from an embedded starter template (#25). A thin
   * pass-through to the lib's `scaffoldProject` — the wizard collects inputs and
   * the lib does the work (template copy, placeholder fill, optional local Git
   * init). The WebAdapter stub rejects (the wizard is desktop-only in 0.4.0).
   */
  createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;

  // ── Local version history (#13) ───────────────────────────────────────────
  // All four run in the host (isomorphic-git via the lib — CLAUDE.md §7); the
  // UI derives which to OFFER from `classifyProject().capabilities`. The
  // WebAdapter stubs reject (mutations) / return [] (listSnapshots).

  /**
   * Turn on local version history for a plain folder (`git init` + first
   * snapshot, all isomorphic-git). Returns the re-classified source +
   * capabilities so the UI can swap "Enable Version History" for the
   * snapshot/history actions without a separate classify round-trip.
   */
  enableVersionHistory(projectDir: string): Promise<ProjectClassification>;
  /**
   * Save an explicit snapshot of the project's current state. `message` is
   * optional author text; the host substitutes a default when blank. Rejects
   * with a friendly message when nothing has changed since the last snapshot.
   */
  saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;
  /** List the project's snapshots, newest first (bounded to one page). */
  listSnapshots(projectDir: string): Promise<SnapshotEntry[]>;
  /**
   * One bounded page of snapshots with a continuation cursor — backs the
   * history dialog's "Show older versions". The walk is capped host-side so
   * a long history can never freeze the dialog.
   */
  listSnapshotsPage(
    projectDir: string,
    options?: ListSnapshotsOptions,
  ): Promise<SnapshotPage>;
  /**
   * Restore the project's files to a chosen snapshot — SAFELY: the host takes
   * an automatic backup snapshot of the current state first (when anything
   * changed), so a restore can never lose work.
   */
  restoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult>;

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
  /** Forget the stored GitHub connection. */
  disconnectGitHub(): Promise<{ ok: boolean }>;
  /** Redacted connection status for a host (default github.com). */
  getRemoteConnection(host?: string): Promise<RemoteConnection>;
  /** Repositories the user granted the print-md GitHub App. */
  listRemoteRepositories(): Promise<RemoteRepository[]>;
  /** Branches of a chosen repository (default branch preselected by the UI). */
  listRemoteBranches(owner: string, repo: string): Promise<RemoteBranch[]>;
  /** Book folders (print-md.yaml/.yml) inside a repository branch. */
  listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]>;
  /** Download ("clone") a repository into a new local project folder. */
  cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  /** Subscribe to clone progress events. Returns an unsubscribe fn. */
  onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;

  // ── Advanced Setup (#14, ADR 0006) ─────────────────────────────────────────
  // Diagnostics are local reads; the ONLY network call is the explicit
  // `testRemoteAccess` probe (user-initiated). `connectGenericHost` validates
  // the pasted token with a refs probe BEFORE the host stores it. WebAdapter:
  // mutations reject; listHostConnections → []; forgeTokenUrl → null.

  /** Classify the project's remote situation for the environment panel. */
  diagnoseProjectRemote(projectDir: string): Promise<ProjectRemoteDiagnosis>;
  /** Explicit, user-initiated remote probe (the `git ls-remote` equivalent). */
  testRemoteAccess(url: string): Promise<RemoteAccessResult>;
  /** Validate + store a credential for any smart-HTTPS Git host. */
  connectGenericHost(
    args: ConnectGenericHostArgs,
  ): Promise<{ connected: boolean; host: string; username?: string }>;
  /** Forget the stored connection for a host. */
  disconnectHost(host: string): Promise<{ ok: boolean }>;
  /** Redacted list of stored connections (host/username/label — no tokens). */
  listHostConnections(): Promise<HostConnectionInfo[]>;
  /** Token-settings deep link for recognized forges; null when unknown. */
  forgeTokenUrl(host: string): Promise<string | null>;

  // ── Sync (#15 sync phase, ADR 0006 D5) ─────────────────────────────────────
  // Snapshot-first sync: the host snapshots unsaved work BEFORE any
  // network/merge step, fetches, fast-forwards or merges, and pushes.
  // Conflicts come back as `{ status: "conflict" }` with per-file rows; the
  // dialog collects "Keep my version / Use the online version / Keep both
  // copies" and calls resolveSyncConflicts. Credentials are resolved
  // host-side and never reach the renderer. WebAdapter stubs reject.

  /** Ahead/behind counts vs the online repository ("N changes to sync"). */
  getSyncStatus(projectDir: string, fetch?: boolean): Promise<SyncStatusInfo>;
  /**
   * Fetch-only preview of what a Sync would do: incoming commits from the
   * online copy, outgoing local commits, and the working-tree edits the
   * pre-sync snapshot would commit. Backs the Sync dialog's open/refresh view.
   */
  previewSync(projectDir: string): Promise<SyncPreviewInfo>;
  /**
   * Local-only sync preview (NO network): incoming is computed against the
   * last-fetched record of the online tip (`live: false`). Backs the Sync
   * dialog's instant first paint while the live previewSync is in flight.
   */
  previewSyncLocal(projectDir: string): Promise<SyncPreviewInfo>;
  /** Snapshot-first sync of the project to its online repository. */
  syncChanges(projectDir: string, message?: string): Promise<SyncOutcome>;
  /** Apply per-file conflict choices and sync the combined result. */
  resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome>;

  // Preview / build
  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  cancelExport(exportId: string): Promise<{ canceled: boolean }>;
  build(args: BuildArgs): Promise<BuildResult>;
  doctor(): Promise<unknown>;

  // Event subscriptions (return an unsubscribe fn)
  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void;

  // ── Unsaved changes / recovery (#44) — Phase-0 stubs, no impl yet ──────────

  /** Write a debounced crash-recovery snapshot of the open buffer (#44). */
  writeRecovery(
    filePath: string,
    content: string,
    baseMtimeMs: number,
  ): Promise<{ ok: boolean }>;
  /** Clear the recovery snapshot for a file after a successful disk save (#44). */
  clearRecovery(filePath: string): Promise<{ ok: boolean }>;
  /** List pending recovery snapshots for an opened project, newest first (#44). */
  listRecovery(projectDir: string): Promise<RecoveryEntry[]>;

  /**
   * Push the renderer's pending-save state to main so the window `close` gate
   * can flush before quitting (#44). Renderer → main, fire-and-forget.
   */
  setDirtyState(isDirty: boolean): Promise<void>;
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

/** The complete host surface the viewer app consumes through `getPlatform()`. */
export interface Platform extends PlatformAdapter, HostServices {}

/**
 * The raw `window.electron` bridge shape exposed by `electron/preload.ts`.
 * Differs from `Platform` in exactly three members the adapter maps/owns:
 * `openDirectory` (→ `Platform.openFolder`), `readFile`, and `writeFile`
 * (the raw fs IPC behind `PlatformAdapter.readFile`/`writeFile`).
 * ONLY `electron-adapter.ts` (and the `Window` global) should reference this —
 * everything else goes through `Platform`.
 */
export interface ElectronBridge extends HostServices {
  openDirectory(): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<FileWriteResult>;
  listDir(path: string): Promise<Array<{ name: string; path: string; isDir: boolean }>>;
  /** Raw fs stat IPC behind `PlatformAdapter.statFile` (#44). */
  statFile(path: string): Promise<FileStat>;
  /**
   * Raw folder-watch IPC behind `PlatformAdapter.watchFolder` (#44). Subscribes
   * to change events for `path` and returns an unsubscribe fn.
   */
  watchFolder(path: string, cb: () => void): () => void;
}
