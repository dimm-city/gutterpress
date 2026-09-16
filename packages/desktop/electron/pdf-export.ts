/**
 * PDF export subsystem — extracted from electron/main.ts (composition root).
 *
 * Owns the single active export session shared by the desktop's PDF export
 * pipeline: progress events, cancellation, and the accessors
 * `electron/export/controller.ts` uses to drive an export.
 *
 * The Electron-hosted PDF renderer itself lives in
 * `electron/engine-browser.ts` (`createElectronEngineBrowser`), injected into
 * `lib.runBuild` as `engineBrowser`.
 */
import type { BrowserWindow } from "electron";
import type { SecureHandle } from "./server-bridge/secure-handle";

export interface ExportProgressEvent {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
}

export interface ExportSession {
  id: string;
  canceled: boolean;
  outPath: string;
  tempOutPath: string;
  win: BrowserWindow | null;
}

export class ExportCanceledError extends Error {
  code = "EXPORT_CANCELED";

  constructor(message = "PDF export canceled") {
    super(message);
    this.name = "ExportCanceledError";
  }
}

let activeExportSession: ExportSession | null = null;

export function getActiveExportSession(): ExportSession | null {
  return activeExportSession;
}

export function setActiveExportSession(session: ExportSession | null): void {
  activeExportSession = session;
}

// The progress sender is injected by main.ts so this module stays free of any
// window/IPC state — it just forwards each event to the live main window.
let sendProgress: (event: ExportProgressEvent) => void = () => {};

export function initPdfExport(deps: {
  sendProgress: (event: ExportProgressEvent) => void;
}): void {
  sendProgress = deps.sendProgress;
}

export function sendExportProgress(event: ExportProgressEvent): void {
  sendProgress(event);
}

export function throwIfExportCanceled(session: ExportSession): void {
  if (session.canceled) {
    throw new ExportCanceledError();
  }
}

/**
 * Register `api:cancelExport` (SFE-P6b, extracted from electron/main.ts).
 * Operates only on this module's own active-export-session state — no
 * mainWindow or other main.ts-composed dependency needed.
 */
export function registerPdfExportHandlers(secureHandle: SecureHandle): void {
  secureHandle("api:cancelExport", async (_e, exportId: string) => {
    const session = getActiveExportSession();
    if (!session || session.id !== exportId) {
      return { canceled: false };
    }
    session.canceled = true;
    const exportWin = session.win;
    if (exportWin && !exportWin.isDestroyed()) {
      exportWin.destroy();
    }
    return { canceled: true };
  });
}
