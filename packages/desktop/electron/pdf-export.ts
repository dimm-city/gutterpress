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
