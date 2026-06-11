import { contextBridge, ipcRenderer } from "electron";

/**
 * Bridge exposed to the SvelteKit renderer as window.electron.
 * Renderer never imports node:* or electron itself — all native work
 * happens here, in the preload, or in main via ipcRenderer.invoke.
 */

// ──────────────────────────────────────────────────────────────────────────
// Updater types — mirror electron/updater/contract.ts; kept local so the
// preload never imports from the main-process updater module.
// ──────────────────────────────────────────────────────────────────────────

interface UpdaterStatus {
  currentVersion: string | null;
  stagedVersion: string | null;
  availableVersion: string | null;
  phase: "idle" | "checking" | "downloading" | "staged" | "error";
  lastCheckAt: string | null;
  error: string | null;
}

type UpdaterEventPayload =
  | { type: "available"; version: string }
  | { type: "staged"; version: string }
  | { type: "uptodate"; reason?: string }
  | { type: "healthy"; version: string }
  | { type: "rolledback"; version: string }
  | { type: "error"; message: string };

interface PreviewStartArgs {
  input: string;
}

interface PreviewStartResult {
  url: string;
  port: number;
  input: string;
  title: string | null;
  missingSharedAssets?: string[];
}

interface BuildArgs {
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

interface BuildResult {
  exportId?: string;
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
}

interface ExportProgressEvent {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
}

interface UrlPreviewBlockedEvent {
  url: string;
  reason: string;
}

// New-project scaffold (#25). Mirrors the lib's CreateProjectOptions/Result.
interface CreateProjectOptions {
  name: string;
  author?: string;
  parentDir: string;
  folderName?: string;
  template?: "book";
  versionHistory?: "local-git" | "none";
}
interface CreateProjectResult {
  projectDir: string;
  manifestPath: string;
  openFile: string;
  versionHistory: "local-git" | "none";
  versionHistoryError?: string;
}

interface RecentFolderEntry {
  path: string;
  title: string;
  openedAt: string;
}

interface FavoriteEntry {
  path: string;
  title: string;
}

interface ProjectState {
  currentPage?: number;
  viewMode?: "single" | "two-column";
  lastChapter?: string;
  sidebarOpen?: boolean;
  cursorLine?: number;
  editorScroll?: number;
  splitPaneRatio?: number;
}

interface ViewerPrefs {
  lastProjectDir?: string | null;
  /** Chapter-list sidebar open/closed, persisted across sessions (#42). */
  sidebarOpen?: boolean;
  /** @deprecated (#43) migration fallback — use projectStates[dir]. */
  currentPage?: number;
  /** @deprecated (#43) migration fallback — use projectStates[dir]. */
  viewMode?: "single" | "two-column";
  recentFolders?: RecentFolderEntry[];
  favorites?: FavoriteEntry[];
  projectStates?: Record<string, ProjectState>;
  projectSearchRoots?: string[];
  projectSource?: ProjectSourceHint;
  /** Global left panel open state + active tab, persisted across sessions. */
  leftPanel?: {
    open?: boolean;
    activeTab?: "toc" | "files" | "media" | "projects" | "history";
  };
}

/** Forward ref used by ViewerPrefs above; full union declared below. */
type ProjectSourceHint =
  | { type: "local-folder"; path: string }
  | {
      type: "local-git-folder";
      path: string;
      repoRoot: string;
      subPath: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

interface DiscoveredProject {
  path: string;
  title: string;
}

// ── Managed GitHub integration (#15). Mirrors the lib's remote-auth types. ──
interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}
interface RemoteConnection {
  connected: boolean;
  username?: string;
  label?: string;
}
interface RemoteRepository {
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
}
interface RemoteBranch {
  name: string;
}
interface RepoBook {
  /** Book folder relative to the repo root ("" = the root itself). */
  path: string;
  /** Display name (folder basename; the repo name for the root). */
  name: string;
}
interface CloneProgressEvent {
  phase: string;
  loaded: number;
  total?: number;
}
interface CloneRepositoryArgs {
  url: string;
  parentDir: string;
  folderName: string;
  branch?: string;
  owner?: string;
  repo?: string;
  /** Book subfolder to open after the clone ("" / absent = repo root). */
  subPath?: string;
}

// ── Advanced Setup (#14). Mirrors the lib's diagnose/test-access types. ──
type RemoteAccessResult =
  | { ok: true; defaultBranch?: string; refCount: number }
  | {
      ok: false;
      reason: "auth" | "not-found" | "unreachable" | "ssh-unsupported" | "tls" | "unknown";
      message: string;
    };

interface ProjectRemoteDiagnosis {
  classification: ProjectSourceHint;
  remoteUrl?: string;
  remoteHost?: string;
  remoteProtocol: "https" | "ssh" | "none";
  branch?: string;
  credentialPresent: boolean;
  provider:
    | "github"
    | "gitea"
    | "forgejo"
    | "gitlab"
    | "bitbucket"
    | "azure"
    | "generic"
    | null;
  tokenSettingsUrl: string | null;
  canSync: boolean;
  /**
   * @deprecated Same value as canSync. Do not use in new code — this field
   * will be removed once all callers have migrated to canSync.
   * (Terminology note: the concept formerly called "publish" is now "Sync";
   * the alias keeps its original name for shape stability.)
   */
  canPublishWhenImplemented: boolean;
  guidance:
    | "local-only"
    | "connect-github-to-sync"
    | "https-connect-server"
    | "ready-to-sync"
    | "ssh-use-own-tools";
}

// ── Sync (#15 sync phase, ADR 0006 D5). Mirrors the lib. ──
interface SyncStatusInfo {
  hasRemote: boolean;
  branch?: string;
  ahead: number | null;
  behind: number | null;
  hasUnsnapshottedChanges: boolean;
  live: boolean;
  /** True when ahead/behind are lower bounds (walk cap or shallow boundary). */
  approximate: boolean;
}

interface SyncCommitInfo {
  id: string;
  message: string;
  author: string;
  timestamp: number;
}

interface SyncDirectionInfo {
  /** true = changes exist, false = none, null = honestly unknown. */
  hasChanges: boolean | null;
  /** Count when derivable from freshly fetched commits; null = no number. */
  count: number | null;
  commits: SyncCommitInfo[];
  approximate: boolean;
}

interface SyncPreviewInfo {
  hasRemote: boolean;
  branch?: string;
  live: boolean;
  fetchNotice?: string;
  incoming: SyncDirectionInfo;
  outgoing: SyncDirectionInfo;
  changedFiles: { count: number; sample: string[] };
}

interface ConflictFileInfo {
  path: string;
  kind: "both-edited" | "you-deleted" | "online-deleted";
}

interface ConflictResolutionChoice {
  path: string;
  choice: "mine" | "theirs" | "both";
}

type SyncOutcome =
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

type PullOutcome =
  | {
      status: "pulled";
      message: string;
      snapshotId?: string;
      merged: boolean;
      incomingApplied: number;
      filesChanged: boolean;
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

type PushOutcome =
  | { status: "pushed"; message: string; snapshotId?: string }
  | { status: "up-to-date"; message: string; snapshotId?: string }
  | { status: "pull-first"; message: string; snapshotId?: string }
  | { status: "auth"; message: string; snapshotId?: string }
  | { status: "offline"; message: string; snapshotId?: string }
  | { status: "error"; message: string; snapshotId?: string };

interface ResolveSyncConflictsArgs {
  projectDir: string;
  resolutions: ConflictResolutionChoice[];
  localId: string;
  remoteId: string;
}

interface ConnectGenericHostArgs {
  host: string;
  username?: string;
  token: string;
  repoUrl?: string;
}

interface HostConnectionInfo {
  host: string;
  kind: "github-oauth" | "token";
  username?: string;
  label?: string;
  createdAt: number;
}

// Local version history (#13): `SnapshotEntry` / `RestoreVersionResult` /
// `ProjectClassification` are the ambient declarations in types.d.ts (single
// electron-side definition; the lib ships no .d.ts to import from yet).

// Project source classification (#12). Mirrors @dimm-city/print-md-lib.
type ProjectSource =
  | { type: "local-folder"; path: string }
  | {
      type: "local-git-folder";
      path: string;
      repoRoot: string;
      subPath: string;
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      owner: string;
      repo: string;
      branch: string;
      rootPath?: string;
    };

interface ProjectCapabilities {
  canRead: boolean;
  canWriteLocal: boolean;
  canEnableVersionHistory: boolean;
  canSnapshot: boolean;
  canViewHistory: boolean;
  canRestoreSnapshot: boolean;
  canSync: boolean;
  authManagedByApp: boolean;
}

interface AppSettings {
  editor: {
    fontFamily: string;
    fontSize: number;
    lineHeight: number;
    spellCheckLanguage: string;
    autoSaveDelay: number;
    crashRecovery: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    previewBg: string;
  };
  preview: {
    defaultZoom: string;
    viewMode: "single" | "two-column";
  };
  versionHistory: {
    /** Save automatic snapshots after edits settle (RC1-3). Default ON. */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires. */
    autoSnapshotMinutes: number;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

type DeepPartialSettings = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

// ──────────────────────────────────────────────────────────────────────────
// Safe push-event forwarding (main → renderer).
//
// EVERY main→renderer subscription MUST go through forwardPush. Two hard
// rules, learned from the 0.5.0-rc.3 clone-progress storm:
//
//  1. Never pass the raw IpcRendererEvent across the contextBridge — only
//     the plain, structured-clone-safe payload.
//  2. Never let the callback's RETURN VALUE cross back into the preload.
//     contextBridge synchronously serializes a bridged function's return
//     value with the structured-clone algorithm. A Svelte 5 `$state`
//     assignment expression (`(p) => (someState = p)`) returns the reactive
//     Proxy, which is not cloneable — every event then throws
//     "Uncaught Error: An object could not be cloned." at the cb call site,
//     thousands of times during a clone. We cannot stop contextBridge from
//     serializing the return value, so the call is wrapped in try/catch and
//     failures are reported ONCE per channel instead of as an uncaught
//     exception storm.
// ──────────────────────────────────────────────────────────────────────────
const warnedPushChannels = new Set<string>();
function forwardPush<T>(channel: string, cb: (data: T) => void): () => void {
  const listener = (_e: unknown, data: T) => {
    try {
      cb(data);
    } catch (err) {
      if (!warnedPushChannels.has(channel)) {
        warnedPushChannels.add(channel);
        console.warn(
          `[preload] listener for "${channel}" threw (reported once; ` +
            `usually a non-cloneable callback return value):`,
          err,
        );
      }
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("electron", {
  // ──────────────────────────────────────────────────────────────────────
  // API version contract.  Must stay in sync with DESKTOP_API in
  // electron/updater/contract.ts.  The renderer checks this to refuse
  // running against a stale shell.
  // ──────────────────────────────────────────────────────────────────────
  apiVersion: 2 as const,

  // ──────────────────────────────────────────────────────────────────────
  // Web-UI auto-update surface
  // ──────────────────────────────────────────────────────────────────────
  updater: {
    getStatus: (): Promise<UpdaterStatus> =>
      ipcRenderer.invoke("updater:getStatus"),
    check: (): Promise<UpdaterStatus> =>
      ipcRenderer.invoke("updater:check"),
    applyNow: (): Promise<{ applied: boolean; version?: string }> =>
      ipcRenderer.invoke("updater:applyNow"),
    markReady: (): Promise<{ ok: true; pending: boolean; version?: string }> =>
      ipcRenderer.invoke("updater:markReady"),
    /** Subscribe to updater events from main. Returns an unsubscribe fn. */
    onEvent: (cb: (data: UpdaterEventPayload) => void): (() => void) =>
      forwardPush("updater:event", cb),
  },

  // Dialogs
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openDirectory"),
  savePdf: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:savePdf", defaultName),
  // Image picker dialog (#31): file selection filtered to image formats
  pickImageFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:pickImageFile"),
  // Multi-select image picker (#47): backs the Media panel's "Add images…"
  pickImageFiles: (): Promise<string[]> =>
    ipcRenderer.invoke("dialog:pickImageFiles"),
  // Copy a file into a destination directory (#31): backs Insert Image asset copy
  copyFile: (srcPath: string, destDir: string): Promise<string> =>
    ipcRenderer.invoke("fs:copyFile", srcPath, destDir),

  // ── Media panel (#47): project image listing / thumbnails / inspection ──
  listProjectImages: (
    projectDir: string,
  ): Promise<
    Array<{ name: string; relPath: string; path: string; size: number; mtimeMs: number }>
  > => ipcRenderer.invoke("media:listImages", projectDir),
  imageThumbnail: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke("media:thumbnail", filePath),
  inspectImage: (
    filePath: string,
  ): Promise<{
    fileSize: number;
    info: {
      width: number;
      height: number;
      xDpi: number;
      yDpi: number;
      hasAlpha: boolean;
      colorSpace: "srgb" | "gray" | "cmyk" | "";
    } | null;
  } | null> => ipcRenderer.invoke("media:inspect", filePath),

  // App actions
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:openExternal", url),
  showInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("shell:showInFolder", filePath),

  // Filesystem primitives (PlatformAdapter, #41 — editor seam for #38/#39)
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath: string, content: string): Promise<{ mtimeMs: number }> =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),
  listDir: (
    dirPath: string,
  ): Promise<Array<{ name: string; path: string; isDir: boolean }>> =>
    ipcRenderer.invoke("fs:listDir", dirPath),
  listProjectFiles: (
    projectDir: string,
  ): Promise<{ md: string[]; css: string[] }> =>
    ipcRenderer.invoke("fs:listProjectFiles", projectDir),
  // CSS print-safety lint (#39) — runs in main (postcss can't bundle into the SPA)
  checkCss: (
    css: string,
    from?: string,
  ): Promise<
    Array<{ rule: string; severity: "error" | "warning"; message: string; line: number; column: number }>
  > => ipcRenderer.invoke("lint:checkCss", css, from),
  // Project-wide source lint for the Problems panel (#28) — runs in main
  lintProject: (
    projectDir: string,
  ): Promise<
    Array<{
      filePath?: string;
      file?: string;
      line?: number;
      column?: number;
      severity: "error" | "warning" | "info";
      message: string;
      source: string;
    }>
  > => ipcRenderer.invoke("lint:project", projectDir),
  // File metadata (PlatformAdapter.statFile, #44 — external-edit detection)
  statFile: (
    filePath: string,
  ): Promise<{ mtimeMs: number; size: number; exists: boolean }> =>
    ipcRenderer.invoke("fs:statFile", filePath),
  /**
   * Watch a project folder for changes (#44). Subscribes to debounced
   * `fs:folderChanged` events for `dirPath` and returns an unsubscribe fn that
   * tears down the main-process watcher. The renderer never sees raw fs events.
   */
  watchFolder: (dirPath: string, cb: () => void): (() => void) => {
    const off = forwardPush("fs:folderChanged", () => cb());
    void ipcRenderer.invoke("fs:watchFolder", dirPath);
    return () => {
      off();
      void ipcRenderer.invoke("fs:unwatchFolder", dirPath);
    };
  },

  // Lib API (replaces /api/* HTTP routes)
  getStatus: (): Promise<{ ok: boolean; runtime: string; name: string }> =>
    ipcRenderer.invoke("api:status"),
  getLastProject: (): Promise<string | null> =>
    ipcRenderer.invoke("app:getLastProject"),
  splashStatus: (status?: string, progress?: number, sub?: string): Promise<void> =>
    ipcRenderer.invoke("app:splashStatus", status, progress, sub),
  rendererReady: (): Promise<void> => ipcRenderer.invoke("app:rendererReady"),
  getViewerPrefs: (): Promise<ViewerPrefs> =>
    ipcRenderer.invoke("app:getViewerPrefs"),
  setViewerPrefs: (patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:setViewerPrefs", patch),
  // Per-project editor/preview state (#43)
  getViewerProjectState: (projectDir: string): Promise<ProjectState | null> =>
    ipcRenderer.invoke("app:getViewerProjectState", projectDir),
  setViewerProjectState: (
    projectDir: string,
    patch: Partial<ProjectState>,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:setViewerProjectState", projectDir, patch),
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke("app:getSettings"),
  setSettings: (patch: DeepPartialSettings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:setSettings", patch),

  // Native (OS) theme surface (#48)
  getNativeTheme: (): Promise<{ shouldUseDarkColors: boolean }> =>
    ipcRenderer.invoke("app:getNativeTheme"),
  /** Subscribe to OS theme changes from main. Returns an unsubscribe fn. */
  onNativeThemeUpdated: (
    cb: (data: { shouldUseDarkColors: boolean }) => void
  ): (() => void) => forwardPush("app:nativeThemeUpdated", cb),

  // Open Location modal: recent folders + favorites
  getRecentFolders: (): Promise<
    Array<{ path: string; title: string; openedAt: string; exists: boolean }>
  > => ipcRenderer.invoke("app:getRecentFolders"),
  getFavorites: (): Promise<
    Array<{ path: string; title: string; exists: boolean }>
  > => ipcRenderer.invoke("app:getFavorites"),
  toggleFavorite: (
    folderPath: string,
    title: string
  ): Promise<{ favorited: boolean }> =>
    ipcRenderer.invoke("app:toggleFavorite", folderPath, title),
  removeRecent: (folderPath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:removeRecent", folderPath),
  discoverProjects: (): Promise<DiscoveredProject[]> =>
    ipcRenderer.invoke("app:discoverProjects"),

  // Project source classification (#12)
  classifyProject: (
    path: string,
  ): Promise<{ source: ProjectSource; capabilities: ProjectCapabilities }> =>
    ipcRenderer.invoke("app:classifyProject", { path }),

  // New-project scaffold (#25)
  createProject: (options: CreateProjectOptions): Promise<CreateProjectResult> =>
    ipcRenderer.invoke("app:createProject", options),

  // Local version history (#13) — isomorphic-git in main, via the lib
  enableVersionHistory: (projectDir: string): Promise<ProjectClassification> =>
    ipcRenderer.invoke("vcs:enableVersionHistory", projectDir),
  saveSnapshot: (projectDir: string, message?: string): Promise<SnapshotEntry> =>
    ipcRenderer.invoke("vcs:saveSnapshot", projectDir, message),
  listSnapshots: (projectDir: string): Promise<SnapshotEntry[]> =>
    ipcRenderer.invoke("vcs:listSnapshots", projectDir),
  listSnapshotsPage: (
    projectDir: string,
    options?: { limit?: number; before?: string },
  ): Promise<SnapshotPage> =>
    ipcRenderer.invoke("vcs:listSnapshotsPage", projectDir, options),
  restoreSnapshot: (
    projectDir: string,
    id: string,
  ): Promise<RestoreVersionResult> =>
    ipcRenderer.invoke("vcs:restoreSnapshot", projectDir, id),

  // ── Managed GitHub integration (#15) — device flow + repo picker + clone ──
  // Two-phase connect: Start returns the user code to display; Wait resolves
  // when the user approves in the browser. Tokens never cross this bridge.
  connectGitHubStart: (): Promise<DeviceCodeInfo> =>
    ipcRenderer.invoke("remote:connectGitHubStart"),
  connectGitHubWait: (): Promise<RemoteConnection> =>
    ipcRenderer.invoke("remote:connectGitHubWait"),
  connectGitHubCancel: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:connectGitHubCancel"),
  disconnectGitHub: (): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:disconnectGitHub"),
  getRemoteConnection: (host?: string): Promise<RemoteConnection> =>
    ipcRenderer.invoke("remote:getConnection", host),
  listRemoteRepositories: (): Promise<RemoteRepository[]> =>
    ipcRenderer.invoke("remote:listRepositories"),
  listRemoteBranches: (owner: string, repo: string): Promise<RemoteBranch[]> =>
    ipcRenderer.invoke("remote:listBranches", owner, repo),
  listRepoBooks: (owner: string, repo: string, branch: string): Promise<RepoBook[]> =>
    ipcRenderer.invoke("remote:listRepoBooks", owner, repo, branch),
  cloneRemoteRepository: (
    args: CloneRepositoryArgs,
  ): Promise<{ projectDir: string }> =>
    ipcRenderer.invoke("remote:cloneRepository", args),
  /** Subscribe to clone progress from main. Returns an unsubscribe fn. */
  onCloneProgress: (cb: (data: CloneProgressEvent) => void): (() => void) =>
    forwardPush("remote:cloneProgress", cb),

  // ── Advanced Setup (#14) — diagnostics + generic "Connect a Git server" ──
  // The token in connectGenericHost crosses renderer → main ONCE for the
  // validate-and-store flow; nothing below ever returns a token.
  diagnoseProjectRemote: (projectDir: string): Promise<ProjectRemoteDiagnosis> =>
    ipcRenderer.invoke("remote:diagnoseProject", projectDir),
  testRemoteAccess: (url: string): Promise<RemoteAccessResult> =>
    ipcRenderer.invoke("remote:testRemoteAccess", url),
  connectGenericHost: (
    args: ConnectGenericHostArgs,
  ): Promise<{ connected: boolean; host: string; username?: string }> =>
    ipcRenderer.invoke("remote:connectGenericHost", args),
  disconnectHost: (host: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("remote:disconnectHost", host),
  listHostConnections: (): Promise<HostConnectionInfo[]> =>
    ipcRenderer.invoke("remote:listConnections"),
  forgeTokenUrl: (host: string): Promise<string | null> =>
    ipcRenderer.invoke("remote:forgeTokenUrl", host),

  // ── Sync (#15 sync phase, ADR 0006 D5) ───────────────────────────────────
  // All git work happens in the lib behind main; credentials are resolved
  // host-side from the safeStorage store and never cross this bridge.
  getSyncStatus: (
    projectDir: string,
    fetch?: boolean,
  ): Promise<SyncStatusInfo> =>
    ipcRenderer.invoke("remote:syncStatus", projectDir, fetch),
  /** Fetch-only "what would a Sync do?" preview (incoming + outgoing). */
  previewSync: (projectDir: string): Promise<SyncPreviewInfo> =>
    ipcRenderer.invoke("remote:previewSync", projectDir),
  /** Local-only preview (no network) — the Sync dialog's instant first paint. */
  previewSyncLocal: (projectDir: string): Promise<SyncPreviewInfo> =>
    ipcRenderer.invoke("remote:previewSyncLocal", projectDir),
  syncChanges: (
    projectDir: string,
    message?: string,
  ): Promise<SyncOutcome> =>
    ipcRenderer.invoke("remote:sync", projectDir, message),
  /** Pull-only: get online changes (fast-forward/merge). Never pushes. */
  pullChanges: (projectDir: string): Promise<PullOutcome> =>
    ipcRenderer.invoke("remote:pullChanges", projectDir),
  /** Push-only: send local changes. "pull-first" when the remote is ahead. */
  pushChanges: (projectDir: string): Promise<PushOutcome> =>
    ipcRenderer.invoke("remote:pushChanges", projectDir),
  resolveSyncConflicts: (
    args: ResolveSyncConflictsArgs,
  ): Promise<SyncOutcome> =>
    ipcRenderer.invoke("remote:resolveSyncConflicts", args),
  startPreview: (args: PreviewStartArgs): Promise<PreviewStartResult> =>
    ipcRenderer.invoke("api:preview", args),
  stopPreview: (): Promise<{ stopped: boolean }> =>
    ipcRenderer.invoke("api:stopPreview"),
  cancelExport: (exportId: string): Promise<{ canceled: boolean }> =>
    ipcRenderer.invoke("api:cancelExport", exportId),
  build: (args: BuildArgs): Promise<BuildResult> =>
    ipcRenderer.invoke("api:build", args),
  doctor: (): Promise<unknown> => ipcRenderer.invoke("api:doctor"),

  // Live PDF-build progress (main → renderer). Returns an unsubscribe fn.
  onBuildProgress: (
    cb: (data: ExportProgressEvent) => void
  ): (() => void) => forwardPush("build:progress", cb),

  onUrlPreviewBlocked: (
    cb: (data: UrlPreviewBlockedEvent) => void
  ): (() => void) => forwardPush("url-preview:blocked", cb),

  // ──────────────────────────────────────────────────────────────────────
  // Unsaved-changes / crash-recovery surface (#44)
  // ──────────────────────────────────────────────────────────────────────

  /** Write a debounced crash-recovery snapshot of the open buffer (#44). */
  writeRecovery: (
    filePath: string,
    content: string,
    baseMtimeMs: number,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("recovery:write", filePath, content, baseMtimeMs),
  /** Clear a recovery snapshot after a successful disk save (#44). */
  clearRecovery: (filePath: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("recovery:clear", filePath),
  /** List pending recovery snapshots for an opened project, newest first (#44). */
  listRecovery: (
    projectDir: string,
  ): Promise<
    Array<{ filePath: string; recoveryPath: string; savedAt: number; baseMtimeMs: number }>
  > => ipcRenderer.invoke("recovery:list", projectDir),

  /** Push the renderer's pending-save state to main for the close gate (#44). */
  setDirtyState: (isDirty: boolean): Promise<void> =>
    ipcRenderer.invoke("app:setDirtyState", isDirty),
  /**
   * Subscribe to main's request to flush before the window closes (#44). The
   * renderer flushes, then calls `app:flushDone` (sent by the buffer store).
   * Returns an unsubscribe fn.
   */
  onFlushBeforeClose: (cb: () => void): (() => void) =>
    forwardPush("app:flushBeforeClose", () => {
      // The renderer flushes its buffer, then signals completion so main can
      // destroy the window. Signal even if the cb throws so quit never hangs.
      void Promise.resolve()
        .then(() => cb())
        .catch(() => {})
        .finally(() => {
          void ipcRenderer.invoke("app:flushDone");
        });
    }),
  /**
   * Subscribe to debounced folder-change notifications carrying the changed
   * file's basename (#44). Returns an unsubscribe fn.
   */
  onFolderChanged: (cb: (data: { filename: string }) => void): (() => void) =>
    forwardPush("fs:folderChanged", cb),
});
