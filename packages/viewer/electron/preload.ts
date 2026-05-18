import { contextBridge, ipcRenderer } from "electron";

/**
 * Bridge exposed to the SvelteKit renderer as window.electron.
 * Renderer never imports node:* or electron itself — all native work
 * happens here, in the preload, or in main via ipcRenderer.invoke.
 */
contextBridge.exposeInMainWorld("electron", {
  openDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:openDirectory"),
  savePdf: (defaultName?: string): Promise<string | null> =>
    ipcRenderer.invoke("dialog:savePdf", defaultName),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:openExternal", url),
});
