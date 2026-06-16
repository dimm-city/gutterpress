// The lib ships no .d.ts yet (see docs/build-pipeline-followups.md). main.ts
// dynamic-imports it and casts the result to its own LibModule interface, so an
// untyped module declaration is all that's needed for the electron typecheck.
declare module "@dimm-city/print-md-lib";

// `?raw` imports (electron-vite/vite) return the file contents as a string. Used
// for the splash markup, which is baked into the main bundle.
declare module "*.html?raw" {
  const content: string;
  export default content;
}

// ──────────────────────────────────────────────────────────────────────────
// window.electron — bridge types for the renderer / SvelteKit SPA
//
// All interface shapes here MUST mirror the implementations in preload.ts and
// electron/updater/contract.ts.  Keep them in sync manually.
// ──────────────────────────────────────────────────────────────────────────

interface UpdaterStatus {
  currentVersion: string | null;
  stagedVersion: string | null;
  availableVersion: string | null;
  phase: "idle" | "checking" | "downloading" | "staged" | "error";
  lastCheckAt: string | null;
  error: string | null;
}

type UpdaterEvent =
  | { type: "available"; version: string }
  | { type: "staged"; version: string }
  | { type: "uptodate"; reason?: string }
  | { type: "healthy"; version: string }
  | { type: "rolledback"; version: string }
  | { type: "error"; message: string };

interface ElectronUpdater {
  getStatus(): Promise<UpdaterStatus>;
  check(): Promise<UpdaterStatus>;
  applyNow(): Promise<{ applied: boolean; version?: string }>;
  markReady(): Promise<{ ok: true; pending: boolean; version?: string }>;
  onEvent(cb: (event: UpdaterEvent) => void): () => void;
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
    /**
     * On small/narrow viewports the editor and preview can't sit side by side,
     * so the workspace collapses to a single pane and this picks which one is
     * shown. Ignored above the responsive breakpoint (split layout). (#responsive)
     */
    paneMode: "edit" | "view";
  };
  versionHistory: {
    /** Save automatic snapshots after edits settle (RC1-3). Default ON. */
    autoSnapshot: boolean;
    /** Minutes of quiet after the last edit before a snapshot fires. */
    autoSnapshotMinutes: number;
    /**
     * Automatically sync to the remote in the background when a remote is
     * configured (transparent-sync plan §6). Defaults ON for projects with
     * canSync; local-only projects are never auto-synced regardless of this
     * setting.
     */
    autoSync: boolean;
    /** Periodic safety-sync cadence in minutes (clamped to [1, 1440]). */
    autoSyncMinutes: number;
  };
  advanced: {
    fileWatcherInterval: number;
    logLevel: "error" | "warn" | "info" | "debug";
  };
}

type DeepPartialSettings = {
  [K in keyof AppSettings]?: Partial<AppSettings[K]>;
};

// Project source classification (#12). Mirrors @dimm-city/print-md-lib.
type ProjectSource =
  | { type: "local-folder"; path: string }
  | {
      type: "local-git-folder";
      path: string;
      /** Repository root holding the history (equals `path` for repo roots). */
      repoRoot: string;
      /** Project dir relative to repoRoot, "/"-separated; "" at the root. */
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

/** A classified project source + its capabilities (#12). */
interface ProjectClassification {
  source: ProjectSource;
  capabilities: ProjectCapabilities;
}

// Local version history (#13). Mirrors the lib's source-provider types.
interface SnapshotEntry {
  id: string;
  message: string;
  timestamp: number;
  author?: string;
}

/** One bounded page of version history (mirrors the lib's HistoryPage). */
interface SnapshotPage {
  entries: SnapshotEntry[];
  /** Older entries exist — pass the last entry's id as `before` to continue. */
  hasMore: boolean;
}

/** Result of a safe restore (#13): `backupId` is the automatic pre-restore snapshot. */
interface RestoreVersionResult {
  restoredId: string;
  backupId?: string;
}

// ── Managed GitHub integration (#15). Mirrors preload.ts + the lib. ─────────
interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** Redacted connection status — never carries the token. */
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

// ── Advanced Setup (#14). Mirrors preload.ts + the lib. ─────────────────────
type RemoteAccessResult =
  | { ok: true; defaultBranch?: string; refCount: number }
  | {
      ok: false;
      reason: "auth" | "not-found" | "unreachable" | "ssh-unsupported" | "tls" | "unknown";
      message: string;
    };

interface ProjectRemoteDiagnosis {
  classification: ProjectSource;
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
  guidance:
    | "local-only"
    | "connect-github-to-sync"
    | "https-connect-server"
    | "ready-to-sync"
    | "ssh-use-own-tools";
}

// ── Sync recovery seam (Foundation — §8 / ADR 0004). Mirrors contract.ts. ───
// Defined locally so the renderer never value-imports the lib.

interface RecoveryConfirmRequest {
  requestId: string;
  projectDir: string;
  confirmation: {
    repair: string;
    risk: "none" | "low" | "medium" | "high";
    summary: string;
    backupZipPath: string;
    willChangeLocalFiles: boolean;
    willChangeGitMetadata: boolean;
    willChangeRemote: boolean;
    canBeUndoneFromBackup: boolean;
  };
}

interface ConflictPreview {
  mine: string;
  theirs: string;
  kind: "both-edited" | "you-deleted" | "online-deleted";
  isBinary: boolean;
}

// ── Sync (#15 sync phase, ADR 0006 D5). Mirrors preload.ts. ─────────────────
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

/** Redacted stored-connection entry — never carries tokens or ciphertext. */
interface HostConnectionInfo {
  host: string;
  kind: "github-oauth" | "token";
  username?: string;
  label?: string;
  createdAt: number;
}

// Per-project editor/preview state (#43). Mirrors electron/project-state.ts.
interface ProjectState {
  currentPage?: number;
  viewMode?: "single" | "two-column";
  lastChapter?: string;
  sidebarOpen?: boolean;
  cursorLine?: number;
  editorScroll?: number;
  splitPaneRatio?: number;
}

interface Window {
  electron?: {
    /** Integer IPC-surface version; mirrors DESKTOP_API in updater/contract.ts. */
    apiVersion: number;
    updater: ElectronUpdater;
    // Dialogs
    openDirectory(): Promise<string | null>;
    savePdf(defaultName?: string): Promise<string | null>;
    // Image picker + copy (#31) — backs the editor toolbar's Insert Image flow
    pickImageFile(): Promise<string | null>;
    copyFile(srcPath: string, destDir: string): Promise<string>;
    // Media panel (#47): multi-select import + image listing/thumbnails/inspect
    pickImageFiles(): Promise<string[]>;
    listProjectImages(
      projectDir: string,
    ): Promise<
      Array<{ name: string; relPath: string; path: string; size: number; mtimeMs: number }>
    >;
    imageThumbnail(filePath: string): Promise<string | null>;
    inspectImage(filePath: string): Promise<{
      fileSize: number;
      info: {
        width: number;
        height: number;
        xDpi: number;
        yDpi: number;
        hasAlpha: boolean;
        colorSpace: "srgb" | "gray" | "cmyk" | "";
      } | null;
    } | null>;
    // App actions
    openExternal(url: string): Promise<void>;
    showInFolder(filePath: string): Promise<void>;
    // Filesystem primitives (PlatformAdapter, #41)
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, content: string): Promise<{ mtimeMs: number }>;
    listDir(
      dirPath: string,
    ): Promise<Array<{ name: string; path: string; isDir: boolean }>>;
    listProjectFiles(
      projectDir: string,
    ): Promise<{ md: string[]; css: string[] }>;
    // CSS print-safety lint (#39) — runs in main; postcss can't bundle into the SPA
    checkCss(
      css: string,
      from?: string,
    ): Promise<Array<{ rule: string; severity: "error" | "warning"; message: string; line: number; column: number }>>;
    // Project-wide source lint for the Problems panel (#28) — runs in main
    lintProject(
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
    >;
    // File metadata + folder watch (PlatformAdapter, #44)
    statFile(
      filePath: string,
    ): Promise<{ mtimeMs: number; size: number; exists: boolean }>;
    watchFolder(dirPath: string, cb: () => void): () => void;
    // Lib API
    getStatus(): Promise<{ ok: boolean; runtime: string; name: string }>;
    getLastProject(): Promise<string | null>;
    // Splash coordination: push status while booting, then signal first-screen ready.
    splashStatus(status?: string, progress?: number, sub?: string): Promise<void>;
    rendererReady(): Promise<void>;
    getViewerPrefs(): Promise<{
      lastProjectDir?: string | null;
      sidebarOpen?: boolean;
      currentPage?: number;
      viewMode?: "single" | "two-column";
      recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
      favorites?: Array<{ path: string; title: string }>;
      projectStates?: Record<string, ProjectState>;
      projectSearchRoots?: string[];
      projectSource?: ProjectSource;
      leftPanel?: {
        open?: boolean;
        activeTab?: "toc" | "files" | "media" | "projects" | "history";
        width?: number;
      };
    }>;
    setViewerPrefs(patch: {
      lastProjectDir?: string | null;
      sidebarOpen?: boolean;
      currentPage?: number;
      viewMode?: "single" | "two-column";
      recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
      favorites?: Array<{ path: string; title: string }>;
      projectStates?: Record<string, ProjectState>;
      projectSearchRoots?: string[];
      projectSource?: ProjectSource;
      leftPanel?: {
        open?: boolean;
        activeTab?: "toc" | "files" | "media" | "projects" | "history";
        width?: number;
      };
    }): Promise<{ ok: boolean }>;
    // Per-project editor/preview state (#43)
    getViewerProjectState(projectDir: string): Promise<ProjectState | null>;
    setViewerProjectState(
      projectDir: string,
      patch: ProjectState,
    ): Promise<{ ok: boolean }>;
    // User settings (#45)
    getSettings(): Promise<AppSettings>;
    setSettings(patch: DeepPartialSettings): Promise<{ ok: boolean }>;
    // Native (OS) theme surface (#48)
    getNativeTheme(): Promise<{ shouldUseDarkColors: boolean }>;
    onNativeThemeUpdated(
      cb: (data: { shouldUseDarkColors: boolean }) => void
    ): () => void;
    // Open Location modal: recent folders + favorites
    getRecentFolders(): Promise<
      Array<{ path: string; title: string; openedAt: string; exists: boolean }>
    >;
    getFavorites(): Promise<
      Array<{ path: string; title: string; exists: boolean }>
    >;
    toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }>;
    removeRecent(folderPath: string): Promise<{ ok: boolean }>;
    // Project discovery (#27)
    discoverProjects(): Promise<Array<{ path: string; title: string }>>;
    // Project source classification (#12)
    classifyProject(path: string): Promise<{
      source: ProjectSource;
      capabilities: ProjectCapabilities;
    }>;
    // New-project scaffold (#25)
    createProject(options: {
      name: string;
      author?: string;
      parentDir: string;
      folderName?: string;
      template?: "book";
      versionHistory?: "local-git" | "none";
    }): Promise<{
      projectDir: string;
      manifestPath: string;
      openFile: string;
      versionHistory: "local-git" | "none";
      versionHistoryError?: string;
    }>;
    // Local version history (#13)
    enableVersionHistory(projectDir: string): Promise<ProjectClassification>;
    saveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry>;
    listSnapshots(projectDir: string): Promise<SnapshotEntry[]>;
    listSnapshotsPage(
      projectDir: string,
      options?: { limit?: number; before?: string },
    ): Promise<SnapshotPage>;
    restoreSnapshot(
      projectDir: string,
      id: string,
    ): Promise<RestoreVersionResult>;
    // Managed GitHub integration (#15)
    connectGitHubStart(): Promise<DeviceCodeInfo>;
    connectGitHubWait(): Promise<RemoteConnection>;
    connectGitHubCancel(): Promise<{ ok: boolean }>;
    disconnectGitHub(): Promise<{ ok: boolean }>;
    getRemoteConnection(host?: string): Promise<RemoteConnection>;
    listRemoteRepositories(): Promise<RemoteRepository[]>;
    listRemoteBranches(owner: string, repo: string): Promise<RemoteBranch[]>;
    listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]>;
    cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
    onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void;
    // Advanced Setup (#14) — diagnostics + generic "Connect a Git server"
    diagnoseProjectRemote(projectDir: string): Promise<ProjectRemoteDiagnosis>;
    testRemoteAccess(url: string): Promise<RemoteAccessResult>;
    connectGenericHost(
      args: ConnectGenericHostArgs,
    ): Promise<{ connected: boolean; host: string; username?: string }>;
    disconnectHost(host: string): Promise<{ ok: boolean }>;
    listHostConnections(): Promise<HostConnectionInfo[]>;
    forgeTokenUrl(host: string): Promise<string | null>;
    // Auto-sync orchestrator seam (transparent sync, §4.4 integration plan)
    /** Subscribe to ambient sync-status push events. Returns an unsubscribe fn.
     *  Note: data may carry `recovery`, `guidance`, and `backupZipPath` fields
     *  when state is 'recovering', 'recovered', or 'error' (classified failure). */
    onSyncStatus(cb: (data: unknown) => void): () => void;
    /** Enable or disable the auto-sync master switch. */
    setAutoSync(enabled: boolean): Promise<void>;
    // Sync recovery seam (Foundation — §8 / ADR 0004)
    /** Subscribe to risky-repair confirm requests from main. Returns unsubscribe fn. */
    onRecoveryConfirm(cb: (data: unknown) => void): () => void;
    /** Send the author's approval/rejection to main to unblock a pending repair. */
    respondRecoveryConfirm(requestId: string, approved: boolean): Promise<void>;
    /** Fetch yours/theirs text for one conflicted file. */
    getConflictPreview(projectDir: string, path: string): Promise<ConflictPreview>;
    // Sync (#15 sync phase, ADR 0006 D5). Auto-sync runs in main; the renderer
    // only triggers a sync to surface conflicts and then applies the choices.
    syncChanges(projectDir: string, message?: string): Promise<SyncOutcome>;
    resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome>;
    startPreview(args: { input: string }): Promise<{
      url: string;
      port: number;
      input: string;
      title: string | null;
      missingSharedAssets?: string[];
    }>;
    stopPreview(): Promise<{ stopped: boolean }>;
    cancelExport(exportId: string): Promise<{ canceled: boolean }>;
    build(args: {
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
    }): Promise<{
      exportId?: string;
      outDir: string;
      htmlPath?: string;
      pdfPath?: string;
      fingerprintPath?: string;
    }>;
    doctor(): Promise<unknown>;
    // Event subscriptions
    onBuildProgress(cb: (data: {
      exportId: string;
      state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
      pages?: number;
      message?: string;
    }) => void): () => void;
    onUrlPreviewBlocked(cb: (data: { url: string; reason: string }) => void): () => void;
    // Unsaved-changes / crash-recovery surface (#44)
    writeRecovery(
      filePath: string,
      content: string,
      baseMtimeMs: number,
    ): Promise<{ ok: boolean }>;
    clearRecovery(filePath: string): Promise<{ ok: boolean }>;
    listRecovery(projectDir: string): Promise<
      Array<{
        filePath: string;
        recoveryPath: string;
        savedAt: number;
        baseMtimeMs: number;
      }>
    >;
    setDirtyState(isDirty: boolean): Promise<void>;
    onFlushBeforeClose(cb: () => void): () => void;
    onFolderChanged(cb: (data: { filename: string }) => void): () => void;
  };
}
