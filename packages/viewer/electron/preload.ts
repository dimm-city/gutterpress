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
  outDir: string;
  htmlPath?: string;
  pdfPath?: string;
  fingerprintPath?: string;
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

  // Lib API (replaces /api/* HTTP routes)
  getStatus: (): Promise<{ ok: boolean; runtime: string; name: string }> =>
    ipcRenderer.invoke("api:status"),
  startPreview: (args: PreviewStartArgs): Promise<PreviewStartResult> =>
    ipcRenderer.invoke("api:preview", args),
  build: (args: BuildArgs): Promise<BuildResult> =>
    ipcRenderer.invoke("api:build", args),
});
