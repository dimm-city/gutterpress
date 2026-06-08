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

interface RecentFolderEntry {
  path: string;
  title: string;
  openedAt: string;
}

interface FavoriteEntry {
  path: string;
  title: string;
}

interface ViewerPrefs {
  lastProjectDir?: string | null;
  currentPage?: number;
  viewMode?: "single" | "two-column";
  recentFolders?: RecentFolderEntry[];
  favorites?: FavoriteEntry[];
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

contextBridge.exposeInMainWorld("electron", {
  // ──────────────────────────────────────────────────────────────────────
  // API version contract.  Must stay in sync with DESKTOP_API in
  // electron/updater/contract.ts.  The renderer checks this to refuse
  // running against a stale shell.
  // ──────────────────────────────────────────────────────────────────────
  apiVersion: 1 as const,

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
    onEvent: (cb: (data: UpdaterEventPayload) => void): (() => void) => {
      const listener = (_e: unknown, data: UpdaterEventPayload) => cb(data);
      ipcRenderer.on("updater:event", listener);
      return () => ipcRenderer.removeListener("updater:event", listener);
    },
  },

  // Dialogs
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openDirectory"),
  savePdf: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:savePdf", defaultName),

  // App actions
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:openExternal", url),
  showInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("shell:showInFolder", filePath),

  // Filesystem primitives (PlatformAdapter, #41 — editor seam for #38/#39)
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("fs:readFile", filePath),
  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke("fs:writeFile", filePath, content),

  // Lib API (replaces /api/* HTTP routes)
  getStatus: (): Promise<{ ok: boolean; runtime: string; name: string }> =>
    ipcRenderer.invoke("api:status"),
  getLastProject: (): Promise<string | null> =>
    ipcRenderer.invoke("app:getLastProject"),
  getViewerPrefs: (): Promise<ViewerPrefs> =>
    ipcRenderer.invoke("app:getViewerPrefs"),
  setViewerPrefs: (patch: Partial<ViewerPrefs>): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:setViewerPrefs", patch),
  getSettings: (): Promise<AppSettings> =>
    ipcRenderer.invoke("app:getSettings"),
  setSettings: (patch: DeepPartialSettings): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("app:setSettings", patch),

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
  ): (() => void) => {
    const listener = (
      _e: unknown,
      data: ExportProgressEvent
    ) => cb(data);
    ipcRenderer.on("build:progress", listener);
    return () => ipcRenderer.removeListener("build:progress", listener);
  },

  onUrlPreviewBlocked: (
    cb: (data: UrlPreviewBlockedEvent) => void
  ): (() => void) => {
    const listener = (_e: unknown, data: UrlPreviewBlockedEvent) => cb(data);
    ipcRenderer.on("url-preview:blocked", listener);
    return () => ipcRenderer.removeListener("url-preview:blocked", listener);
  },
});
