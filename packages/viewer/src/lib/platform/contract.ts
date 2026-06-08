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
import type { PlatformAdapter } from "@dimm-city/print-md-lib";

export type { PlatformAdapter };

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

export interface ViewerPrefs {
  lastProjectDir?: string | null;
  currentPage?: number;
  viewMode?: "single" | "two-column";
  recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
  favorites?: Array<{ path: string; title: string }>;
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
  getViewerPrefs(): Promise<ViewerPrefs>;
  setViewerPrefs(patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }>;
  getSettings(): Promise<AppSettings>;
  setSettings(patch: DeepPartial<AppSettings>): Promise<{ ok: boolean }>;
  getRecentFolders(): Promise<RecentFolderEntry[]>;
  getFavorites(): Promise<FavoriteEntry[]>;
  toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }>;
  removeRecent(folderPath: string): Promise<{ ok: boolean }>;

  // Preview / build
  startPreview(args: PreviewStartArgs): Promise<PreviewStartResult>;
  stopPreview(): Promise<{ stopped: boolean }>;
  cancelExport(exportId: string): Promise<{ canceled: boolean }>;
  build(args: BuildArgs): Promise<BuildResult>;
  doctor(): Promise<unknown>;

  // Event subscriptions (return an unsubscribe fn)
  onBuildProgress(cb: (data: ExportProgressEvent) => void): () => void;
  onUrlPreviewBlocked(cb: (data: UrlPreviewBlockedEvent) => void): () => void;
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
  writeFile(path: string, content: string): Promise<void>;
}
