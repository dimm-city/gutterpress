import { contextBridge, ipcRenderer } from "electron";

/**
 * Bridge exposed to the SvelteKit renderer as window.electron.
 * Renderer never imports node:* or electron itself — all native work
 * happens here, in the preload, or in main via ipcRenderer.invoke.
 */

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

contextBridge.exposeInMainWorld("electron", {
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

  // Lib API (replaces /api/* HTTP routes)
  getStatus: (): Promise<{ ok: boolean; runtime: string; name: string }> =>
    ipcRenderer.invoke("api:status"),
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
