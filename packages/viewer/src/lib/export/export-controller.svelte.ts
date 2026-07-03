/**
 * ExportController (Phase 4b) — the single owner of the PDF-export finite state
 * machine that used to live inline in `+page.svelte`.
 *
 * Centralises the export status pill's state: the FSM state
 * (idle → started → rendering → finalizing → success / canceling), the running
 * page count, the elapsed-seconds ticker, and the human `pdfProgress` label.
 *
 * Single-owner discipline mirrors `EditorBuffer` (`buffer-state.svelte.ts`):
 * the component reads the public rune getters (`exporting`, `pdfProgress`,
 * `state`, `activeExportId`, …) and calls the intent methods (`start`,
 * `syncProgress`, `markCanceling`, `markSuccess`, `reset`, …).
 *
 * PWA-clean (§8 / ADR 0004): pure UI/timer state, ZERO `node:*` imports and no
 * lib value imports. The 1-second ticker is injected through a timer seam so the
 * FSM and label formatting are unit-testable without a DOM or real clock.
 */

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
 * Defined locally (not imported from the lib) so the renderer stays PWA-clean.
 */
export type ExportProgressEvent = {
  exportId: string;
  state: "started" | "rendering" | "finalizing" | "success" | "canceled" | "error";
  pages?: number;
  message?: string;
};

/**
 * Timer seam so the elapsed-seconds ticker can be driven by a fake clock in
 * tests. Defaults to the global `setInterval`/`clearInterval`.
 */
export interface ExportTimerSeam {
  setInterval: (cb: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
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

  constructor(timers?: Partial<ExportTimerSeam>) {
    this.timers = {
      setInterval:
        timers?.setInterval ?? ((cb: () => void, ms: number) => setInterval(cb, ms)),
      clearInterval:
        timers?.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>)),
    };
  }

  /** Begin a PDF export: reset counters, enter "started", start the 1s ticker. */
  start(): void {
    this.exporting = true;
    this.state = "started";
    this.pages = 0;
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
    this.pdfProgress = null;
  }

  /** Recompute `pdfProgress` from the current FSM state + counters. */
  updateLabel(): void {
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
    if (!this.activeExportId) this.activeExportId = event.exportId;
    if (event.pages) this.pages = event.pages;
    if (event.state === "started") this.state = "started";
    else if (event.state === "rendering") this.state = "rendering";
    else if (event.state === "finalizing") this.state = "finalizing";
    else if (event.state === "success") this.state = "success";
    this.updateLabel();
  }

  /** Enter the canceling state and refresh the label. */
  markCanceling(): void {
    this.state = "canceling";
    this.updateLabel();
  }

  /** Record success: adopt the host export id, stop the ticker, refresh label. */
  markSuccess(exportId?: string | null): void {
    if (exportId) this.activeExportId = exportId;
    this.state = "success";
    this.stopTimer();
    this.updateLabel();
  }
}
