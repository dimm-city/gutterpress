/**
 * ExportController (Phase 4b; host intents added Phase 5 slice 2) — the single
 * owner of the PDF-export finite state machine AND the `savePdf`/`exportHtml`/
 * `cancelExport` intents that used to live inline in `+page.svelte` (UX H5 /
 * ARCH #10).
 *
 * Centralises the export status pill's state: the FSM state
 * (idle → started → rendering → finalizing → success / canceling), the running
 * page count, the elapsed-seconds ticker, and the human `pdfProgress` label.
 *
 * Single-owner discipline mirrors `EditorBuffer` (`buffer-state.svelte.ts`):
 * the component reads the public rune getters (`exporting`, `pdfProgress`,
 * `state`, `activeExportId`, …) and calls the intent methods (`start`,
 * `syncProgress`, `markCanceling`, `markSuccess`, `reset`, `savePdf`,
 * `exportHtml`, `cancelExport`, …).
 *
 * The FSM half stays pure UI/timer state (ZERO `node:*` / lib value imports);
 * the 1-second ticker is injected through a timer seam so it's unit-testable
 * without a DOM or real clock. The host-intent half needs real round-trips
 * (the save dialog, the build, the toast surface, …), so — like
 * `ProjectLifecycleController` — that coupling is injected through the
 * optional second constructor argument, `ExportHostDeps`, keeping this module
 * itself PWA-clean (§8 / ADR 0004): DOM manipulation for the HTML download
 * (`document.createElement("a")`, …) stays in `+page.svelte` behind the
 * `downloadFile` dep, not here. `host` is optional so the pure-FSM
 * constructor shape existing tests use (`new ExportController(timers)`) is
 * unchanged; `savePdf`/`exportHtml`/`cancelExport` throw a clear error if
 * called without it (a programming error, not a reachable runtime state —
 * `+page.svelte` always constructs its one instance with host deps).
 *
 * M27's "one guard covering every entry point" (`if (this.exporting) return`)
 * moved here verbatim as `savePdf`'s first line — every caller (toolbar
 * button, both keyboard shortcuts) now goes through this one method instead
 * of each re-implementing the guard.
 */

import { basenameOf } from "../platform/paths";

/** The export pill's FSM state. */
export type ExportState =
  | "idle"
  | "started"
  | "rendering"
  | "finalizing"
  | "canceling"
  | "success";

/**
 * Progress event shape emitted by the host build over `onBuildProgress`.
 *
 * M29 (2026-07-10 UX review): this used to be a byte-identical SECOND copy of
 * `shared-types.ts`'s `ExportProgressEvent`, justified by a PWA-cleanliness
 * comment that didn't actually apply — `shared-types.ts` is itself renderer-
 * local (no `node:*` / lib value imports) and a `import type` re-export here
 * is erased at build time, so it stays §8-clean. Re-exported (not just
 * imported) so existing consumers (`+page.svelte`, this file's own tests)
 * don't need their import path to change.
 */
export type { ExportProgressEvent } from "../platform/shared-types";
import type { ExportProgressEvent } from "../platform/shared-types";

/**
 * Timer seam so the elapsed-seconds ticker can be driven by a fake clock in
 * tests. Defaults to the global `setInterval`/`clearInterval`.
 */
export interface ExportTimerSeam {
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

/**
 * Host coupling for `savePdf`/`exportHtml`/`cancelExport` (moved from
 * `+page.svelte` in the H5/#10 slice-2 extraction). All host work — the save
 * dialog, the build round-trip, the toast surface, the download — goes
 * through this seam so the controller stays testable with fakes and PWA-clean.
 */
export interface ExportHostDeps {
  isDesktop: () => boolean;
  desktopRequiredMessage: string;
  /**
   * Compute the plain-language reason PDF export isn't ready yet (or null
   * when ready) — `+page.svelte`'s existing `getSaveReadinessWarning()`.
   * `setSaveWarning` receives the result unconditionally (even null, to
   * clear a stale warning), exactly matching the original
   * `lifecycle.saveWarning = getSaveReadinessWarning()` assignment.
   */
  checkSaveReadiness: () => string | null;
  setSaveWarning: (message: string | null) => void;
  currentDir: () => string | null;
  /** Adapter-precomputed display name for the open folder, or null (#49). */
  displayName: () => string | null;
  isBusy: () => boolean;
  sourceMode: () => "folder" | "url";
  /** The native "Save PDF as…" dialog; null/empty means the author canceled. */
  chooseSavePath: (defaultName: string) => Promise<string | null>;
  onBuildProgress: (cb: (event: ExportProgressEvent) => void) => (() => void) | undefined;
  buildPdf: (
    input: { key: string; displayName: string },
    outPath: string,
    opts?: { validate?: boolean },
  ) => Promise<{ exportId?: string; pdfPath?: string }>;
  buildHtml: (input: { key: string; displayName: string }) => Promise<{ downloadUrl?: string }>;
  cancelExportHost: (exportId: string) => Promise<unknown>;
  /** Turns a `blob:` download URL into a browser download (web HTML export). */
  downloadFile: (url: string, filename: string) => void;
  showInFolder: (path: string) => Promise<unknown>;
  toastSuccess: (
    message: string,
    durationMs?: number,
    action?: { label: string; onClick: () => void },
  ) => void;
  toastError: (message: string) => void;
  friendlyPdfError: (e: unknown) => string;
  /** Injected so the post-save 2s pill-linger delay is fake-clock-able in tests. */
  wait: (ms: number) => Promise<void>;
}

export class ExportController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** True while any export (PDF FSM or the simple HTML path) is in flight. */
  exporting = $state(false);
  /** Human-facing status label for the pill; null when there is nothing to show. */
  pdfProgress = $state<string | null>(null);
  /** The host's export id once known — gates the Cancel button + progress match. */
  activeExportId = $state<string | null>(null);
  /** The FSM state driving the pill icon and label. */
  state = $state<ExportState>("idle");
  /** Running page count reported by the host. */
  pages = $state(0);
  /** Seconds since the export started (only shown once ≥ 3s). */
  elapsedSeconds = $state(0);

  private timer: unknown = null;
  private timers: ExportTimerSeam;
  /**
   * Host-supplied label override for the pre-build phase (M28) — e.g. "Syncing
   * latest changes…" while the pre-export sync safety gate runs. Set from a
   * "started" event that carries a `message`; cleared once a normal FSM state
   * (or another "started" with no message) arrives. Kept separate from
   * `pdfProgress` so the 1s ticker's `updateLabel()` re-asserts it each tick
   * instead of being clobbered by the elapsed-seconds label.
   */
  private pendingMessage: string | null = null;

  /** Host coupling for `savePdf`/`exportHtml`/`cancelExport` — see `ExportHostDeps`. */
  private host?: ExportHostDeps;

  constructor(timers?: Partial<ExportTimerSeam>, host?: ExportHostDeps) {
    this.timers = {
      setInterval:
        timers?.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms)),
      clearInterval:
        timers?.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)),
    };
    this.host = host;
  }

  private requireHost(): ExportHostDeps {
    if (!this.host) {
      throw new Error("ExportController: host deps required for savePdf/exportHtml/cancelExport");
    }
    return this.host;
  }

  /** Begin a PDF export: reset counters, enter "started", start the 1s ticker. */
  start(): void {
    this.exporting = true;
    this.state = "started";
    this.pages = 0;
    // M27: a second export (either keyboard shortcut, uncaught by savePdf()'s
    // own guard) used to inherit the FIRST export's activeExportId here — its
    // own "started" event then never matched (syncProgress ignores non-
    // matching ids) and its Cancel targeted the wrong export. start() must be
    // as much a full reset as reset() is for this one field.
    this.activeExportId = null;
    this.pendingMessage = null;
    this.pdfProgress = "Preparing PDF…";
    this.startTimer();
  }

  /**
   * Mark the simple (HTML) export busy WITHOUT entering the PDF FSM/timer —
   * the web HTML export shows only the "Exporting…" button label, no pill.
   */
  beginSimpleExport(): void {
    this.exporting = true;
  }

  /** End the simple (HTML) export busy flag. */
  endSimpleExport(): void {
    this.exporting = false;
  }

  private startTimer(): void {
    if (this.timer) this.timers.clearInterval(this.timer);
    this.elapsedSeconds = 0;
    this.timer = this.timers.setInterval(() => {
      this.elapsedSeconds += 1;
      this.updateLabel();
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timer) {
      this.timers.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Full teardown back to idle: stop the ticker and clear all state. */
  reset(): void {
    this.stopTimer();
    this.exporting = false;
    this.activeExportId = null;
    this.state = "idle";
    this.pages = 0;
    this.elapsedSeconds = 0;
    this.pendingMessage = null;
    this.pdfProgress = null;
  }

  /** Recompute `pdfProgress` from the current FSM state + counters. */
  updateLabel(): void {
    // M28: a host-supplied pre-build label (e.g. "Syncing latest changes…")
    // wins over the normal FSM label until it is cleared — re-asserted here
    // so the 1s ticker doesn't overwrite it with "Preparing PDF… Ns".
    if (this.pendingMessage) {
      this.pdfProgress = this.pendingMessage;
      return;
    }
    const elapsed = this.elapsedSeconds >= 3 ? ` ${this.elapsedSeconds}s` : "";
    if (this.state === "success") {
      this.pdfProgress = `PDF saved${elapsed}`;
      return;
    }
    if (this.state === "canceling") {
      this.pdfProgress = "Canceling export…";
      return;
    }
    if (this.state === "finalizing") {
      this.pdfProgress =
        this.pages > 0 ? `Finalizing PDF (${this.pages} pages)…${elapsed}` : `Finalizing PDF…${elapsed}`;
      return;
    }
    if (this.state === "rendering") {
      this.pdfProgress =
        this.pages > 0 ? `Exporting page ${this.pages}…${elapsed}` : `Exporting…${elapsed}`;
      return;
    }
    this.pdfProgress = `Preparing PDF…${elapsed}`;
  }

  /** Fold a host progress event into the FSM (ignores events for other exports). */
  syncProgress(event: ExportProgressEvent): void {
    if (this.activeExportId && event.exportId !== this.activeExportId) return;
    // Adopting the id here (not only from the "real" started event) is what
    // makes M28's pre-gate event light up Cancel immediately — Cancel is
    // gated on `activeExportId` alone (+page.svelte), and this is the
    // earliest event the host can send.
    if (!this.activeExportId) this.activeExportId = event.exportId;
    if (event.pages) this.pages = event.pages;
    if (event.state === "conflict") {
      // M29: the pre-export sync safety gate found an unresolved conflict.
      // The SAME conflict is already routed to ConflictChoicesDialog via the
      // independent sync:status channel (AutoSyncOrchestrator.latchConflict →
      // SyncStatusPill → SyncController.onPillConflict) — this event only
      // needs to stop the export pill being left stuck on "Preparing PDF…"
      // underneath that dialog. build()'s rejected promise (SYNC_CONFLICT)
      // also calls reset() in savePdf()'s finally; this is the earlier,
      // idempotent path so the pill clears the instant the host knows.
      this.reset();
      return;
    }
    if (event.state === "started") {
      this.state = "started";
      // Pre-export sync safety gate (M28, electron/export/controller.ts):
      // the host sends this SAME wire state early — before it even knows
      // whether a sync is needed — carrying a descriptive `message`. Reusing
      // "started" + the existing free-text `message` field (instead of a new
      // state value) keeps ExportProgressEvent's `state` union identical
      // end-to-end. The later bare "started" (no message) marks the real
      // build start and reverts to the normal ticking label.
      this.pendingMessage = event.message ?? null;
      this.updateLabel();
      return;
    }
    this.pendingMessage = null;
    if (event.state === "rendering") this.state = "rendering";
    else if (event.state === "finalizing") this.state = "finalizing";
    else if (event.state === "success") this.state = "success";
    this.updateLabel();
  }

  /** Enter the canceling state and refresh the label. */
  markCanceling(): void {
    this.pendingMessage = null;
    this.state = "canceling";
    this.updateLabel();
  }

  /** Record success: adopt the host export id, stop the ticker, refresh label. */
  markSuccess(exportId?: string | null): void {
    if (exportId) this.activeExportId = exportId;
    this.pendingMessage = null;
    this.state = "success";
    this.stopTimer();
    this.updateLabel();
  }

  // ── Host intents (moved from +page.svelte, Phase 5 slice 2) ────────────────

  /**
   * Save the open project as a PDF: pick a destination, drive the FSM through
   * the build, and show the resulting toast. Moved verbatim from
   * `+page.svelte`'s `savePdf()`.
   */
  async savePdf(opts?: { validate?: boolean }): Promise<void> {
    const h = this.requireHost();
    // M27: one guard covering every entry point (toolbar button, both
    // keyboard shortcuts) — previously only the toolbar button's `disabled`
    // attribute checked `exporting`, so either keyboard shortcut could start
    // a second concurrent export and cross-wire the two exports' pill/Cancel.
    if (this.exporting) return;
    const warning = h.checkSaveReadiness();
    h.setSaveWarning(warning);
    if (warning) return;
    const inputDir = h.currentDir();
    if (!inputDir) return;
    if (!h.isDesktop()) {
      h.toastError(h.desktopRequiredMessage);
      return;
    }
    // #49: use the adapter-precomputed displayName for the default filename,
    // falling back to the basename of the key.
    const defaultName = (h.displayName() ?? basenameOf(inputDir) ?? "book") + ".pdf";
    const outPath = await h.chooseSavePath(defaultName);
    if (!outPath) return;

    // Non-blocking: the build runs in a separate render window, so keep the
    // preview interactive and show progress in a corner pill (not the overlay).
    this.start();
    let offProgress: (() => void) | undefined;
    try {
      // Live progress: pagination of large books can take time, so show the
      // growing page count instead of an opaque spinner.
      offProgress = h.onBuildProgress((p) => {
        if (p.state === "canceled") {
          this.markCanceling();
          return;
        }
        if (p.state === "error") {
          return;
        }
        this.syncProgress(p);
      });
      const data = await h.buildPdf(
        // #49: the app-facing contract takes a FolderRef (key + displayName).
        { key: inputDir, displayName: h.displayName() ?? basenameOf(inputDir) },
        outPath,
        { validate: opts?.validate ?? false },
      );
      this.markSuccess(data.exportId);
      const savedPdfPath = data.pdfPath ?? outPath;
      h.toastSuccess(`PDF saved to ${savedPdfPath}`, 8000, {
        label: "Show in Folder",
        onClick: () => {
          void h.showInFolder(savedPdfPath).catch(() => {});
        },
      });
      await h.wait(2000);
    } catch (e) {
      if ((e as { code?: string })?.code === "EXPORT_CANCELED") {
        this.reset();
        return;
      }
      h.toastError(h.friendlyPdfError(e));
    } finally {
      offProgress?.();
      this.reset();
    }
  }

  /**
   * #33 Phase 5: HTML export on web. PDF is desktop-only (puppeteer/
   * printToPDF), so on the web (capabilities().nativeSavePath === false) the
   * export delivers a standalone book.html instead — build() renders it
   * in-browser and returns a blob: downloadUrl, which the host's
   * `downloadFile` turns into a browser download. Desktop is UNCHANGED: it
   * never reaches here (canSavePdf gates the Save PDF button and build()
   * returns a path-based result there, handled by `savePdf`). Moved verbatim
   * from `+page.svelte`'s `exportHtml()`.
   */
  async exportHtml(): Promise<void> {
    const h = this.requireHost();
    const inputDir = h.currentDir();
    if (!inputDir || h.isBusy() || this.exporting || h.sourceMode() === "url") return;
    this.beginSimpleExport();
    try {
      const displayName = h.displayName() ?? basenameOf(inputDir) ?? "book";
      const data = await h.buildHtml({ key: inputDir, displayName });
      // The web delivery is a downloadUrl (blob:); the host turns it into a
      // download via a transient <a download> click. Gate on its presence so
      // a path-based (desktop) result would never trigger this branch.
      if (data.downloadUrl) {
        h.downloadFile(data.downloadUrl, `${displayName}.html`);
        h.toastSuccess("HTML exported");
      } else {
        // M22: build() resolving without a downloadUrl used to be a silent
        // no-op — the button flashed "Exporting…" then went quiet with no
        // file and no explanation.
        h.toastError("HTML export failed: no file was produced.");
      }
    } catch (e) {
      h.toastError(h.friendlyPdfError(e) || "HTML export failed");
    } finally {
      this.endSimpleExport();
    }
  }

  /** Cancel the in-flight PDF export. Moved verbatim from `+page.svelte`'s `cancelExport()`. */
  async cancelExport(): Promise<void> {
    const h = this.requireHost();
    if (!this.activeExportId) return;
    this.markCanceling();
    await h.cancelExportHost(this.activeExportId).catch(() => {});
  }
}
