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
}
