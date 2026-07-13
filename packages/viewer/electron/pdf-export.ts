/**
 * PDF export subsystem — extracted from electron/main.ts (composition root).
 *
 * Owns the single active export session and the Electron-native PDF renderer.
 * The renderer uses Electron's OWN bundled Chromium (a hidden BrowserWindow +
 * webContents.printToPDF) instead of spawning an external Chromium via
 * puppeteer. The viewer already ships Chromium (it IS Electron), so this drops
 * the external-browser dependency for PDF export with zero added bytes and full
 * Paged.js fidelity (ADR 0002, Phase 4). Injected into lib.runBuild as the
 * `pdfRenderer` override; the lib still serves the staged HTML + assets on a
 * local HTTP server, so asset resolution is identical to the puppeteer path.
 *
 * Escape hatch: set PRINTMD_VIEWER_PUPPETEER=1 to fall back to the lib's default
 * puppeteer renderer (requires a system/bundled Chromium on PATH).
 *
 * main.ts injects the progress sender (which targets the live main window) via
 * initPdfExport(); it never keeps export state of its own — the single
 * activeExportSession lives here and is reached through the accessors below.
 */
import { BrowserWindow } from "electron";
import { writeFile } from "node:fs/promises";
import { BuildError } from "@dimm-city/print-md";

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

export function requireActiveExportSession(): ExportSession {
  if (!activeExportSession) {
    throw new Error("No active export session");
  }
  return activeExportSession;
}

export function throwIfExportCanceled(session: ExportSession): void {
  if (session.canceled) {
    throw new ExportCanceledError();
  }
}

/** Dependencies of {@link waitForPagedRendered}, injected so the timeout-vs-done
 * distinction (ARCH review #27) is unit-testable without a real BrowserWindow. */
export interface WaitForPagedRenderedDeps {
  /** Reads `window.__PAGED_RENDERED__` + the current `.pagedjs_page` count. */
  getStatus: () => Promise<{ done: boolean; pages: number }>;
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable delay between polls. */
  sleep: (ms: number) => Promise<void>;
  /** Called each time the rendered page count changes, for progress events. */
  onProgress: (pages: number) => void;
  /** Throws (e.g. ExportCanceledError) if the export was canceled meanwhile. */
  checkCanceled: () => void;
}

/**
 * Poll Paged.js's completion flag until it flips true or `timeoutMs` elapses.
 *
 * Extracted standalone (no BrowserWindow/webContents) from `electronPdfRenderer`
 * so it can be driven with fakes in tests. Previously this loop's two exit
 * conditions — "Paged.js signaled done" and "the deadline passed" — were
 * indistinguishable to the caller, which fell through to `printToPDF` either
 * way and wrote a TRUNCATED "successful" PDF on a slow/stuck render (ARCH
 * review #27). On timeout this now throws a typed, author-friendly
 * `BuildError` instead of returning, so no caller can mistake "gave up" for
 * "finished". `BuildError` is what `ExportController.build()` (and the CLI's
 * own build pipeline) already recognizes and maps to a `BUILD_ERROR`-coded
 * error — but that `code` does NOT survive the `api:build`
 * ipcMain.handle/ipcRenderer.invoke boundary (Electron re-wraps the error and
 * drops custom properties), so the renderer's `friendlyPdfError`
 * (src/lib/errors.ts) instead recognizes this message by its stable, distinct
 * "did not finish" phrase and passes it through to the author verbatim. Keep
 * that phrase in sync with the exact string thrown below.
 */
export async function waitForPagedRendered(
  timeoutMs: number,
  deps: WaitForPagedRenderedDeps
): Promise<number> {
  const deadline = deps.now() + timeoutMs;
  let lastPages = -1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const status = await deps.getStatus();
    if (status.pages !== lastPages) {
      lastPages = status.pages;
      deps.onProgress(status.pages);
    }
    deps.checkCanceled();
    if (status.done) return status.pages;
    if (deps.now() > deadline) {
      const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
      // No trailing period: the renderer's friendlyPdfError (src/lib/errors.ts)
      // matches this message by its "did not finish" phrase (errors.ts:70)
      // BEFORE the generic `code === "BUILD_ERROR"` branch (errors.ts:73), so
      // it is returned verbatim via friendlyHostError and is never wrapped as
      // `PDF generation failed: ... Open Help (?) for setup details.` —
      // there's no following period to double up. Whether this sentence ends
      // in a period is purely a stylistic choice for the standalone toast.
      throw new BuildError(
        `Rendering did not finish after ${minutes} minute${minutes === 1 ? "" : "s"} — ` +
        `the export was stopped to avoid an incomplete PDF`
      );
    }
    await deps.sleep(100);
  }
}

export async function electronPdfRenderer(input: {
  url: string;
  outPdf: string;
  timeoutMs: number;
}): Promise<void> {
  const session = requireActiveExportSession();
  throwIfExportCanceled(session);
  const win = new BrowserWindow({
    show: false,
    // A hidden window is "occluded", so Chromium throttles its timers,
    // requestAnimationFrame, and rendering to ~1 Hz — which makes Paged.js
    // pagination (timer/rAF-driven) crawl, the #1 cause of slow PDF export.
    // Disable background throttling and keep painting while hidden, and give the
    // window a real size so layout/pagination run at full speed.
    paintWhenInitiallyHidden: true,
    width: 1280,
    height: 1024,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      javascript: true,
      backgroundThrottling: false,
    },
  });
  session.win = win;
  try {
    await win.loadURL(input.url);
    throwIfExportCanceled(session);
    const wc = win.webContents;

    // Wait for web fonts to finish loading.
    await wc.executeJavaScript("document.fonts.ready.then(() => true)");
    throwIfExportCanceled(session);

    // Poll until Paged.js signals completion, emitting a per-page progress
    // event so the UI can show "Rendering page N…" instead of an opaque
    // spinner during the (inherently slow) Paged.js pagination of large
    // books. Throws a typed BuildError instead of returning if the timeout
    // elapses first — see waitForPagedRendered's doc comment (ARCH #27).
    const lastPages = await waitForPagedRendered(input.timeoutMs, {
      getStatus: () =>
        wc.executeJavaScript(`(() => ({
          done: window.__PAGED_RENDERED__ === true,
          pages: document.querySelectorAll('.pagedjs_page').length
        }))()`) as Promise<{ done: boolean; pages: number }>,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      onProgress: (pages) =>
        sendExportProgress({ exportId: session.id, state: "rendering", pages }),
      checkCanceled: () => throwIfExportCanceled(session),
    });

    // Pagination done — serializing a large PDF still takes time, so flag it.
    throwIfExportCanceled(session);
    sendExportProgress({
      exportId: session.id,
      state: "finalizing",
      pages: lastPages,
    });

    // Measure the first rendered page (CSS px) to set the paper size.
    const info = (await wc.executeJavaScript(`(() => {
      const pages = document.querySelectorAll('.pagedjs_page');
      const el = pages[0] || null;
      const s = el ? getComputedStyle(el) : null;
      const px = (v) => (v ? parseFloat(v) : 0);
      return { count: pages.length, w: px(s && s.width), h: px(s && s.height) };
    })()`)) as { count: number; w: number; h: number };

    // printToPDF pageSize is in INCHES; CSS px → in is px / 96. Fall back to a
    // US-Letter-ish book trim if measurement failed.
    const widthIn = info.w > 0 ? info.w / 96 : 8.625;
    const heightIn = info.h > 0 ? info.h / 96 : 11.25;

    throwIfExportCanceled(session);
    const data = await wc.printToPDF({
      printBackground: true,
      pageSize: { width: widthIn, height: heightIn },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    throwIfExportCanceled(session);
    await writeFile(input.outPdf, data);
  } catch (error) {
    if (session.canceled) {
      throw new ExportCanceledError();
    }
    throw error;
  } finally {
    if (!win.isDestroyed()) {
      win.destroy();
    }
    if (session.win === win) {
      session.win = null;
    }
  }
}
