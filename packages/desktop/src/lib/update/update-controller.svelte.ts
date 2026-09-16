/**
 * UpdateController (Phase 5) — the single owner of the auto-update banner state
 * and actions that used to live inline in `+page.svelte`.
 *
 * Centralises the update surface: the staged/available version banner state, the
 * "dismissed" flag, the in-flight check/download flags, the mount-time status
 * peek + event subscription, and the check/download/apply intent methods.
 *
 * Single-owner discipline mirrors `ExportController`
 * (`export/export-controller.svelte.ts`): the component reads the public rune
 * getters (`readyVersion`, `availableVersion`, `availableAction`,
 * `bannerDismissed`, `checking`, `downloading`) and calls the intent methods
 * (`init`, `check`, `download`, `applyNow`, `dismissBanner`).
 *
 * PWA-clean (§8 / ADR 0004): pure UI state driven through the updater
 * capability module (`$lib/update/updater-capability`) plus `isDesktop()`,
 * ZERO `node:*` imports and no lib value imports. Toast feedback is injected
 * through an accessor seam so this stays decoupled from the Toast
 * component's late (bind:api) initialisation.
 */

import { isDesktop } from "$lib/platform";
import {
  applyUpdateNow,
  checkForUpdate,
  downloadUpdate,
  getUpdaterStatus,
  onUpdaterEvent,
} from "./updater-capability";
import type {
  UpdaterAvailableAction,
  UpdaterEvent,
  UpdaterStatus,
} from "$lib/platform/contract";

/** Minimal toast surface used for update feedback; injected by the component. */
export interface UpdateToastSink {
  info?(msg: string): void;
  error?(msg: string): void;
}

export class UpdateController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Non-null when a staged bundle is ready to apply (restart to update). */
  readyVersion = $state<string | null>(null);
  /** Non-null when a check found an update but it hasn't been downloaded yet. */
  availableVersion = $state<string | null>(null);
  /** Host-specific action for the available update (download vs GitHub page). */
  availableAction = $state<UpdaterAvailableAction | null>(null);
  /** True once the user dismisses the current banner. */
  bannerDismissed = $state(false);
  /** True while a manual "Check for updates" is in flight. */
  checking = $state(false);
  /** True while a download is in flight. */
  downloading = $state(false);

  private toast: () => UpdateToastSink | null | undefined;

  constructor(toast: () => UpdateToastSink | null | undefined) {
    this.toast = toast;
  }

  /** Dismiss the current banner (the "Later" button). */
  dismissBanner(): void {
    this.bannerDismissed = true;
  }

  /**
   * Surface the restart banner if an update was already downloaded (this
   * session's background check, or a prior session that never restarted), then
   * subscribe to future events. Returns a teardown for the subscription.
   */
  init(): (() => void) | void {
    if (!isDesktop()) return;

    // Peek at current status so we can surface a banner immediately if an
    // update was found or downloaded during a previous run.
    getUpdaterStatus()
      .then((status: UpdaterStatus) => {
        if (status.stagedVersion) {
          this.readyVersion = status.stagedVersion;
          this.availableVersion = null;
          this.availableAction = null;
          this.bannerDismissed = false;
        } else if (status.availableVersion) {
          this.readyVersion = null;
          this.availableVersion = status.availableVersion;
          this.availableAction = status.availableAction;
          this.bannerDismissed = false;
        } else {
          this.readyVersion = null;
          this.availableVersion = null;
          this.availableAction = null;
        }
      })
      .catch(() => {});

    // Subscribe to future events from main.
    // Events fire for BOTH the silent background launch/focus check and the
    // manual "Check for updates" button. React to "available" (show the
    // Download banner) and "staged" (show the restart banner) live.
    // "uptodate"/"error" are intentionally silent — surfacing them here would
    // toast on every launch and would double-toast during a manual check
    // (which drives its own feedback from the IPC return value in
    // check()).
    const off = onUpdaterEvent((event: UpdaterEvent) => {
      if (event.type === "available") {
        this.readyVersion = null;
        this.availableVersion = event.version;
        this.availableAction = event.action;
        this.bannerDismissed = false;
      } else if (event.type === "staged") {
        this.readyVersion = event.version;
        this.availableVersion = null;
        this.availableAction = null;
        this.bannerDismissed = false;
      } else if (event.type === "uptodate") {
        // A newer check can invalidate a previously advertised download. Keep
        // a staged installer truthful, but clear stale not-yet-downloaded UI.
        this.availableVersion = null;
        this.availableAction = null;
      }
    });

    return () => off?.();
  }

  async check(): Promise<void> {
    if (!isDesktop()) return;
    this.checking = true;
    this.toast()?.info?.("Checking for updates…");
    try {
      const status = await checkForUpdate();
      if (status.stagedVersion) {
        // Preserve the staged action even when this re-check itself failed.
        this.readyVersion = status.stagedVersion;
        this.availableVersion = null;
        this.availableAction = null;
        this.bannerDismissed = false;
      } else if (status.phase === "available") {
        // Preserve the available action even when this re-check itself failed.
        this.readyVersion = null;
        this.availableVersion = status.availableVersion;
        this.availableAction = status.availableAction;
        this.bannerDismissed = false;
      } else if (status.phase === "error") {
        // No actionable update existed before the failed check.
      } else {
        this.readyVersion = null;
        this.availableVersion = null;
        this.availableAction = null;
      }

      if (status.error) {
        this.toast()?.error?.(status.error);
      } else if (status.stagedVersion) {
        // The restart banner is sufficient feedback.
      } else if (status.phase === "available") {
        const instruction =
          status.availableAction === "open-release"
            ? "use the banner to download it from GitHub."
            : "use the banner to download it.";
        this.toast()?.info?.(`Update available (v${status.availableVersion}) — ${instruction}`);
      } else if (status.phase === "error") {
        this.toast()?.error?.("Update check failed.");
      } else {
        this.toast()?.info?.("You're up to date.");
      }
    } catch (e) {
      this.toast()?.error?.(e instanceof Error ? e.message : "Update check failed.");
    } finally {
      this.checking = false;
    }
  }

  async download(): Promise<void> {
    if (!isDesktop()) return;
    const action = this.availableAction;
    this.downloading = true;
    try {
      const status = await downloadUpdate();
      if (status.stagedVersion) {
        this.readyVersion = status.stagedVersion;
        this.availableVersion = null;
        this.availableAction = null;
      } else {
        // A failed action returns to phase "available" so the same banner can
        // be retried; mirror the host's retained target before reporting it.
        this.availableVersion = status.availableVersion;
        this.availableAction = status.availableAction;
      }
      if (status.error) {
        this.toast()?.error?.(status.error);
      } else if (!status.stagedVersion && action === "open-release") {
        this.toast()?.info?.("Opened the latest release on GitHub.");
      }
    } catch (e) {
      this.toast()?.error?.(e instanceof Error ? e.message : "Update download failed.");
    } finally {
      this.downloading = false;
    }
  }

  async applyNow(): Promise<void> {
    if (!isDesktop()) return;
    try {
      const result = await applyUpdateNow();
      // On success main quits, installs the update, and relaunches — this
      // code never runs. On failure, reconcile whether the staged action is
      // still retryable before reporting the host's actionable error.
      if (!result.applied) {
        // Generic installer failures remain staged and retryable. A missing
        // installer is invalidated host-side into an available/download action;
        // mirror the authoritative status so the stale Restart banner clears.
        try {
          const status = await getUpdaterStatus();
          if (status.stagedVersion) {
            this.readyVersion = status.stagedVersion;
            this.availableVersion = null;
            this.availableAction = null;
          } else {
            this.readyVersion = null;
            this.availableVersion = status.availableVersion;
            this.availableAction = status.availableAction;
            if (status.availableVersion) this.bannerDismissed = false;
          }
        } catch {
          // Keep the last truthful banner if the follow-up status read fails.
        }
        this.toast()?.error?.(
          result.error ?? "The update could not be applied — try checking for updates again.",
        );
      }
    } catch (e) {
      this.toast()?.error?.(e instanceof Error ? e.message : "Could not apply update.");
    }
  }
}
