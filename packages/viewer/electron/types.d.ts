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
      hasRemote: boolean;
      remoteUrl?: string;
      branch?: string;
    }
  | {
      type: "managed-github";
      installationId: string;
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
  canPublish: boolean;
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

/** Result of a safe restore (#13): `backupId` is the automatic pre-restore snapshot. */
interface RestoreVersionResult {
  restoredId: string;
  backupId?: string;
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
    restoreSnapshot(
      projectDir: string,
      id: string,
    ): Promise<RestoreVersionResult>;
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
