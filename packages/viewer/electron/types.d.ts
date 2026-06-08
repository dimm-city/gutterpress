// The lib ships no .d.ts yet (see docs/build-pipeline-followups.md). main.ts
// dynamic-imports it and casts the result to its own LibModule interface, so an
// untyped module declaration is all that's needed for the electron typecheck.
declare module "@dimm-city/print-md-lib";

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
    writeFile(filePath: string, content: string): Promise<void>;
    // Lib API
    getStatus(): Promise<{ ok: boolean; runtime: string; name: string }>;
    getLastProject(): Promise<string | null>;
    getViewerPrefs(): Promise<{
      lastProjectDir?: string | null;
      currentPage?: number;
      viewMode?: "single" | "two-column";
      recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
      favorites?: Array<{ path: string; title: string }>;
    }>;
    setViewerPrefs(patch: {
      lastProjectDir?: string | null;
      currentPage?: number;
      viewMode?: "single" | "two-column";
      recentFolders?: Array<{ path: string; title: string; openedAt: string }>;
      favorites?: Array<{ path: string; title: string }>;
    }): Promise<{ ok: boolean }>;
    // User settings (#45)
    getSettings(): Promise<AppSettings>;
    setSettings(patch: DeepPartialSettings): Promise<{ ok: boolean }>;
    // Open Location modal: recent folders + favorites
    getRecentFolders(): Promise<
      Array<{ path: string; title: string; openedAt: string; exists: boolean }>
    >;
    getFavorites(): Promise<
      Array<{ path: string; title: string; exists: boolean }>
    >;
    toggleFavorite(folderPath: string, title: string): Promise<{ favorited: boolean }>;
    removeRecent(folderPath: string): Promise<{ ok: boolean }>;
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
  };
}
