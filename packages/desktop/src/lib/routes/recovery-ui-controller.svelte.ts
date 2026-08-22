/**
 * RecoveryUiController (Phase 5b) — the single owner of the repair-overlay
 * state that used to live inline in `+page.svelte`.
 *
 * 2026-08-14 simplification: repair is ONE automatic pipeline
 * (`repairRepo` in the lib) with no confirmation gates and no manual-guidance
 * routing, so the RecoveryConfirmDialog / RecoveryGuidanceDialog surfaces are
 * gone. What remains is the non-blocking RecoveryOverlay scrim shown while a
 * repair runs ("Tidying up sync…") and its success state.
 *
 * This controller has NO injected deps — it is a pure state machine. The
 * `onMount` subscription in `+page.svelte` keeps the DOM/host glue and
 * delegates the transition to `applyStatus`. `SyncStatus` /
 * `RecoveryProgressInfo` are type-only imports — ZERO `node:*` / lib value
 * imports (PWA-clean, §8 / ADR 0004).
 */

import type { RecoveryProgressInfo, SyncStatus } from "../platform/contract";

export class RecoveryUiController {
  // ── RecoveryOverlay: shown during automated repair (non-blocking scrim) ─────
  /** True while the recovery overlay scrim is showing. */
  recoveryOverlayVisible = $state(false);
  /** The repair phase label shown in the overlay. */
  recoveryOverlayPhase = $state<RecoveryProgressInfo["phase"]>("checking");
  /** Whether the overlay is mid-repair or showing its success state. */
  recoveryOverlayState = $state<"recovering" | "recovered">("recovering");
  /** Captured on-disk backup path for the "show backup" affordance. */
  recoveryBackupZipPath = $state<string | undefined>(undefined);
  /** Captured operation-log path. */
  recoveryLogFilePath = $state<string | null>(null);

  /**
   * Apply a recovery-relevant sync status:
   *  - recovering → overlay visible + recovering, phase from status (fallback
   *    "checking"), capture backup/log paths.
   *  - recovered → overlay visible + recovered, backup/log fall back to prior.
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
    } else if (status.state === "recovered") {
      // Repair completed — transition overlay to success state; it auto-dismisses.
      this.recoveryOverlayVisible = true;
      this.recoveryOverlayState = "recovered";
      this.recoveryBackupZipPath = status.backupZipPath ?? this.recoveryBackupZipPath;
      this.recoveryLogFilePath = status.logFile ?? this.recoveryLogFilePath;
    } else {
      // Any other state — if the overlay was showing (e.g. from a previous
      // repair cycle), hide it.
      if (status.state !== "syncing") {
        this.recoveryOverlayVisible = false;
      }
    }
  }

  /** Called when the RecoveryOverlay auto-dismiss or Done button fires. */
  dismissOverlay(): void {
    this.recoveryOverlayVisible = false;
  }
}
