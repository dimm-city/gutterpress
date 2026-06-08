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
} from "@dimm-city/print-md-lib";

export type {
  PlatformAdapter,
  ProjectSource,
  ProjectCapabilities,
  FileStat,
  FileWriteResult,
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

  /**
   * List the top-level `.md` and `.css` files of an opened project directory
   * (#42), each sorted by filename. Shallow by design (subdirectory layouts
   * are not surfaced in v1). `projectDir` must be an absolute path. Backs the
   * chapter-list sidebar. The WebAdapter stub rejects.
   */
  listProjectFiles(projectDir: string): Promise<{ md: string[]; css: string[] }>;
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
