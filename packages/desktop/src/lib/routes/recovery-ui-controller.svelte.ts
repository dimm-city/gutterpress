/**
 * RecoveryUiController (Phase 5b) — the single owner of the transparent-sync
 * recovery UI state machine that used to live inline in `+page.svelte`.
 *
 * Centralises the three recovery surfaces the renderer drives off the host's
 * `sync:status` / `onRecoveryConfirm` channels:
 *
 *  - RecoveryOverlay — the non-blocking scrim shown during automated repair
 *    (`recoveryOverlayVisible` / `recoveryOverlayPhase` / `recoveryOverlayState`
 *    + the captured `recoveryBackupZipPath` / `recoveryLogFilePath`).
 *  - RecoveryGuidanceDialog — shown when a repair is blocked / a classifiable
 *    error needs manual guidance (`recoveryGuidanceOpen` / `recoveryGuidance` +
 *    the captured `recoveryGuidanceBackupPath` / `recoveryGuidanceLogPath`).
 *  - RecoveryConfirmDialog — shown when the host needs author approval for a
 *    risky repair (`recoveryConfirmOpen` / `recoveryConfirmRequest`).
 *
 * Single-owner discipline mirrors `ExportController`
 * (`export/export-controller.svelte.ts`), `UpdateController`
 * (`update/update-controller.svelte.ts`), and `PageNavController`
 * (`page-nav-controller.svelte.ts`): the component reads the public rune getters
 * and calls the intent methods.
 *
 * This controller has NO injected deps — it is a pure state machine. The two
 * `onMount` subscriptions in `+page.svelte` keep the DOM/host glue (filter by
 * `status.projectDir === currentDir`, the `shouldReconcileAfterSync` /
 * `onSyncFilesChanged` calls) and then delegate the transition to
 * `applyStatus` / `applyConfirm`. `SyncStatus` / `RecoveryConfirmRequest` /
 * `ManualGuidanceInfo` / `RecoveryProgressInfo` are type-only imports — ZERO
 * `node:*` / lib value imports (PWA-clean, §8 / ADR 0004).
 */

import type {
  ManualGuidanceInfo,
  RecoveryConfirmRequest,
  RecoveryProgressInfo,
  SyncStatus,
} from "../platform/contract";

export class RecoveryUiController {
  // ── RecoveryOverlay: shown during automated repair (non-blocking scrim) ─────
  /** True while the recovery overlay scrim is showing. */
  recoveryOverlayVisible = $state(false);
  /** The repair phase label shown in the overlay. */
  recoveryOverlayPhase = $state<RecoveryProgressInfo["phase"]>("checking");
  /** Whether the overlay is mid-repair or showing its success state. */
  recoveryOverlayState = $state<"recovering" | "recovered">("recovering");
  /** Captured backup-zip path for the "show backup" affordance. */
  recoveryBackupZipPath = $state<string | undefined>(undefined);
  /** Captured operation-log path. */
  recoveryLogFilePath = $state<string | null>(null);

  // ── RecoveryGuidanceDialog: shown when repair is blocked / classifiable ─────
  /** True while the manual-guidance dialog is open. */
  recoveryGuidanceOpen = $state(false);
  /** The classified guidance info driving the dialog copy + action. */
  recoveryGuidance = $state<ManualGuidanceInfo | undefined>(undefined);
  /** Captured backup-zip path surfaced in the guidance dialog. */
  recoveryGuidanceBackupPath = $state<string | null>(null);
  /** Captured operation-log path surfaced in the guidance dialog. */
  recoveryGuidanceLogPath = $state<string | null>(null);

  // ── RecoveryConfirmDialog: shown when host needs author approval ────────────
  /** True while the risky-repair confirm dialog is open. */
  recoveryConfirmOpen = $state(false);
  /** The pending confirm request the dialog answers. */
  recoveryConfirmRequest = $state<RecoveryConfirmRequest | undefined>(undefined);

  /**
   * Apply a recovery-relevant sync status. The exact if/else transition moved
   * verbatim from `+page.svelte`:
   *  - recovering → overlay visible + recovering, phase from status (fallback
   *    "checking"), capture backup/log, force guidance closed.
   *  - recovered → overlay visible + recovered, backup/log fall back to prior.
   *  - error + guidance → hide overlay, populate + open guidance, capture paths.
   *  - else → hide overlay UNLESS the state is "syncing".
   */
  applyStatus(status: SyncStatus): void {
    if (status.state === "recovering") {
      // Automated repair in progress — show the non-dismissable overlay.
      this.recoveryOverlayVisible = true;
      this.recoveryOverlayState = "recovering";
      this.recoveryOverlayPhase = status.recovery?.phase ?? "checking";
      this.recoveryBackupZipPath = status.backupZipPath;
      this.recoveryLogFilePath = status.logFile ?? null;
      // Close guidance dialog if a new recovery attempt starts.
      this.recoveryGuidanceOpen = false;
    } else if (status.state === "recovered") {
      // Repair completed — transition overlay to success state; it auto-dismisses.
      this.recoveryOverlayVisible = true;
      this.recoveryOverlayState = "recovered";
      this.recoveryBackupZipPath = status.backupZipPath ?? this.recoveryBackupZipPath;
      this.recoveryLogFilePath = status.logFile ?? this.recoveryLogFilePath;
    } else if (status.state === "error" && status.guidance) {
      // Classified failure that needs manual guidance — hide overlay, open dialog.
      this.recoveryOverlayVisible = false;
      this.recoveryGuidance = status.guidance;
      this.recoveryGuidanceBackupPath = status.backupZipPath ?? null;
      this.recoveryGuidanceLogPath = status.logFile ?? null;
      this.recoveryGuidanceOpen = true;
    } else {
      // Any other state (synced/up-to-date/offline/auth/conflict/idle) — if the
      // overlay was showing (e.g. from a previous recovery cycle), hide it.
      if (status.state !== "syncing") {
        this.recoveryOverlayVisible = false;
      }
    }
  }

  /**
   * The host fires this when a medium/high-risk repair needs author approval.
   * Show RecoveryConfirmDialog; the dialog answers the gate via
   * respondRecoveryConfirm.
   */
  applyConfirm(req: RecoveryConfirmRequest): void {
    this.recoveryConfirmRequest = req;
    this.recoveryConfirmOpen = true;
  }

  /** Called when the RecoveryOverlay auto-dismiss or Done button fires. */
  dismissOverlay(): void {
    this.recoveryOverlayVisible = false;
  }
}
