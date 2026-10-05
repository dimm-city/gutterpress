/**
 * ExportController — the single owner of the PDF-export finite state machine
 * AND the `savePdf`/`buildTo`/`cancelExport` intents.
 *
 * Centralises the export status pill's state: the FSM state
 * (idle → started → rendering → finalizing → success / canceling), the running
 * page count, the elapsed-seconds ticker, and the human `pdfProgress` label.
 *
 * Single-owner discipline mirrors `EditorBuffer` (`buffer-state.svelte.ts`):
 * the component reads the public rune getters (`exporting`, `pdfProgress`,
 * `state`, `activeExportId`, …) and calls the intent methods (`start`,
 * `syncProgress`, `markCanceling`, `markSuccess`, `reset`, `savePdf`,
 * `buildTo`, `cancelExport`, …).
 *
 * The FSM half stays pure UI/timer state (ZERO `node:*` / lib value imports);
 * the 1-second ticker is injected through a timer seam so it's unit-testable
 * without a DOM or real clock. The host-intent half needs real round-trips (the
 * save dialog, the build, the toast surface, …), so — like
 * `ProjectLifecycleController` — that coupling is injected through the optional
 * second constructor argument, `ExportHostDeps`, keeping this module itself
 * PWA-clean (§8). `host` is optional so the pure-FSM tests can construct it
 * with timers only (`new ExportController(timers)`);
 * `savePdf`/`buildTo`/`cancelExport` throw a clear error if called without it
 * (a programming error, not a reachable runtime state — `+page.svelte` always
 * constructs its one instance with host deps).
 *
 * The "one guard covering every entry point" (`if (this.exporting) return`)
 * is `savePdf`'s first line — every caller (toolbar button, both keyboard
 * shortcuts) goes through this one method instead of each re-implementing
 * the guard.
 */

import { overWideExportMessage } from "../errors";
import { basenameOf, isPathAtOrUnder, joinPath } from "../platform/paths";

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
 * Re-exported from `shared-types.ts` rather than copied: that module is
 * renderer-local (no `node:*` / lib value imports) and an `import type`
 * re-export is erased at build time, so it stays §8-clean. Re-exported (not
 * just imported) so consumers (`+page.svelte`, this file's own tests) can
 * import it from here.
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
 * Host coupling for `savePdf`/`buildTo`/`cancelExport`. All host work — the save
 * dialog, the build round-trip, the toast surface, the download — goes
 * through this seam so the controller stays testable with fakes and PWA-clean.
 */
export interface ExportHostDeps {
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
  /** The native "Save PDF as…" dialog; null/empty means the author canceled.
   *  `defaultDir` pre-points it at the folder the author chose earlier. */
  chooseSavePath: (defaultName: string, defaultDir?: string) => Promise<string | null>;
  /** The native "choose where to save" folder dialog (website builds outside
   *  the book); null means the author canceled. */
  pickOutputFolder: (defaultPath: string) => Promise<string | null>;
  onBuildProgress: (cb: (event: ExportProgressEvent) => void) => (() => void) | undefined;
  buildPdf: (
    input: { key: string; displayName: string },
    outPath: string,
    opts?: { validate?: boolean; allowShrink?: boolean },
  ) => Promise<{ exportId?: string; pdfPath?: string }>;
  /** `out` is the destination FOLDER. */
  buildHtml: (
    input: { key: string; displayName: string },
    out?: string,
  ) => Promise<{ outDir?: string }>;
  cancelExportHost: (exportId: string) => Promise<unknown>;
  showInFolder: (path: string) => Promise<unknown>;
  toastSuccess: (
    message: string,
    durationMs?: number,
    action?: { label: string; onClick: () => void },
  ) => void;
  /**
   * `durationMs` 0 keeps the toast up until dismissed, and `action` puts a
   * button on it — both used only by the over-wide "Build anyway" offer
   * (#163), which the author has to read and decide on.
   */
  toastError: (
    message: string,
    durationMs?: number,
    action?: { label: string; onClick: () => void | Promise<void> },
  ) => void;
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
   * Host-supplied label override for the pre-build phase — e.g. "Syncing
   * latest changes…" while the pre-export sync safety gate runs. Set from a
   * "started" event that carries a `message`; cleared once a normal FSM state
   * (or another "started" with no message) arrives. Kept separate from
   * `pdfProgress` so the 1s ticker's `updateLabel()` re-asserts it each tick
   * instead of being clobbered by the elapsed-seconds label.
   */
  private pendingMessage: string | null = null;

  /** Host coupling for `savePdf`/`buildTo`/`cancelExport` — see `ExportHostDeps`. */
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
      throw new Error("ExportController: host deps required for savePdf/buildTo/cancelExport");
    }
    return this.host;
  }

  /** Begin a PDF export: reset counters, enter "started", start the 1s ticker. */
  start(): void {
    this.exporting = true;
    this.state = "started";
    this.pages = 0;
    // A second export (either keyboard shortcut, uncaught by savePdf()'s own
    // guard) must not inherit the FIRST export's activeExportId here — its own
    // "started" event would then never match (syncProgress ignores non-
    // matching ids) and its Cancel would target the wrong export. start() must
    // be as much a full reset as reset() is for this one field.
    this.activeExportId = null;
    this.pendingMessage = null;
    this.pdfProgress = "Preparing PDF…";
    this.startTimer();
  }

  /**
   * Mark the simple (HTML) export busy WITHOUT entering the PDF FSM/timer —
   * the HTML (website) export shows only the "Exporting…" button label, no
   * pill.
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
    // A host-supplied pre-build label (e.g. "Syncing latest changes…")
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
    // makes the pre-gate event light up Cancel immediately — Cancel is
    // gated on `activeExportId` alone (+page.svelte), and this is the
    // earliest event the host can send.
    if (!this.activeExportId) this.activeExportId = event.exportId;
    if (event.pages) this.pages = event.pages;
    if (event.state === "started") {
      this.state = "started";
      // Pre-export sync safety gate (electron/export/controller.ts):
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

  // ── Host intents ───────────────────────────────────────────────────────────

  /**
   * Save the open project as a PDF: pick a destination, drive the FSM through
   * the build, and show the resulting toast.
   */
  async savePdf(opts?: { validate?: boolean; allowShrink?: boolean }): Promise<void> {
    const h = this.requireHost();
    // One guard covering every entry point (toolbar button, both keyboard
    // shortcuts) — a `disabled` attribute alone leaves either keyboard
    // shortcut free to start a second concurrent export and cross-wire the
    // two exports' pill/Cancel.
    if (this.exporting) return;
    const warning = h.checkSaveReadiness();
    h.setSaveWarning(warning);
    if (warning) return;
    const inputDir = h.currentDir();
    if (!inputDir) return;
    // #49: use the adapter-precomputed displayName for the default filename,
    // falling back to the basename of the key.
    const defaultName = (h.displayName() ?? basenameOf(inputDir) ?? "book") + ".pdf";
    const outPath = await h.chooseSavePath(defaultName);
    if (!outPath) return;
    await this.runPdfBuild(inputDir, outPath, opts);
  }

  /**
   * Build the book into a FOLDER — the Publish wizard's first step, which
   * every other destination then uploads from. A folder inside the book
   * (the default, `dist`) needs no dialog; one outside it is confirmed in
   * the native dialog each time, pre-pointed at that folder, because the
   * host only writes outside the book to a destination a dialog returned.
   * Resolves with the artifact path (the PDF file, or the website folder),
   * or null when the author canceled or the build failed (already toasted).
   */
  async buildTo(opts: {
    format: "pdf" | "html";
    dir: string;
    validate?: boolean;
  }): Promise<string | null> {
    const h = this.requireHost();
    if (this.exporting) return null;
    const warning = h.checkSaveReadiness();
    h.setSaveWarning(warning);
    if (warning) return null;
    const inputDir = h.currentDir();
    if (!inputDir) return null;
    const displayName = h.displayName() ?? basenameOf(inputDir) ?? "book";
    const insideBook = isPathAtOrUnder(opts.dir, inputDir);

    if (opts.format === "pdf") {
      let outPath: string | null = joinPath(opts.dir, `${displayName}.pdf`);
      if (!insideBook) outPath = await h.chooseSavePath(`${displayName}.pdf`, opts.dir);
      if (!outPath) return null;
      return this.runPdfBuild(inputDir, outPath, { validate: opts.validate });
    }

    let out: string | null = opts.dir;
    if (!insideBook) out = await h.pickOutputFolder(opts.dir);
    if (!out) return null;
    this.beginSimpleExport();
    try {
      const data = await h.buildHtml({ key: inputDir, displayName }, out);
      const savedDir = data.outDir ?? out;
      h.toastSuccess(`Website saved to ${savedDir}`, 8000, {
        label: "Show in Folder",
        onClick: () => {
          void h.showInFolder(savedDir).catch(() => {});
        },
      });
      return savedDir;
    } catch (e) {
      h.toastError(h.friendlyPdfError(e) || "Website export failed");
      return null;
    } finally {
      this.endSimpleExport();
    }
  }

  /** The PDF build proper, once a destination is known: drive the FSM, toast
   *  the result. Resolves with the saved PDF path, or null on cancel/failure. */
  private async runPdfBuild(
    inputDir: string,
    outPath: string,
    opts?: { validate?: boolean; allowShrink?: boolean },
  ): Promise<string | null> {
    const h = this.requireHost();
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
        { validate: opts?.validate ?? false, allowShrink: opts?.allowShrink ?? false },
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
      return savedPdfPath;
    } catch (e) {
      if ((e as { code?: string })?.code === "EXPORT_CANCELED") {
        this.reset();
        return null;
      }
      // #163: the engine's over-wide-content check is a hard error whose
      // message tells the author to "pass allowShrink" — an instruction with
      // no desktop equivalent. Offer it HERE instead, on the failure that
      // provoked it, naming the offenders and what accepting it costs. This
      // is deliberately not a standing checkbox in the export dialog: a
      // permanent opt-out invites shipping a silently scaled-down book,
      // while an offer only exists when a real over-wide element does.
      const overWide = opts?.allowShrink ? null : overWideExportMessage(e);
      if (overWide) {
        h.toastError(overWide, 0, {
          label: "Build anyway",
          // The host consumes the Save-dialog capability for `out` on every
          // build (electron/export/controller.ts), so the retry
          // goes back through the dialog rather than replaying a path this
          // failed export already spent.
          onClick: () => this.savePdf({ validate: opts?.validate, allowShrink: true }),
        });
      } else {
        h.toastError(h.friendlyPdfError(e));
      }
      return null;
    } finally {
      offProgress?.();
      this.reset();
    }
  }

  /** Cancel the in-flight PDF export. */
  async cancelExport(): Promise<void> {
    const h = this.requireHost();
    if (!this.activeExportId) return;
    this.markCanceling();
    await h.cancelExportHost(this.activeExportId).catch(() => {});
  }
}
