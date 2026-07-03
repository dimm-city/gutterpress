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
 * getters (`readyVersion`, `availableVersion`, `bannerDismissed`, `checking`,
 * `downloading`) and calls the intent methods (`init`, `check`, `download`,
 * `applyNow`, `dismissBanner`).
 *
 * PWA-clean (§8 / ADR 0004): pure UI state driven through the platform adapter
 * (`getPlatform()` / `isDesktop()`), ZERO `node:*` imports and no lib value
 * imports. Toast feedback is injected through an accessor seam so this stays
 * decoupled from the Toast component's late (bind:api) initialisation.
 */

import { getPlatform, isDesktop } from "$lib/platform";

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
    const platform = getPlatform();

    // Peek at current status so we can surface a banner immediately if an
    // update was found or downloaded during a previous run.
    platform.updater
      .getStatus()
      .then((status: { stagedVersion: string | null; availableVersion: string | null }) => {
        if (status.stagedVersion) {
          this.readyVersion = status.stagedVersion;
          this.bannerDismissed = false;
        } else if (status.availableVersion) {
          this.availableVersion = status.availableVersion;
          this.bannerDismissed = false;
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
    const off = platform.updater.onEvent((event: { type: string; version?: string }) => {
      if (event.type === "available") {
        this.availableVersion = event.version ?? null;
        this.bannerDismissed = false;
      } else if (event.type === "staged") {
        this.readyVersion = event.version ?? null;
        this.availableVersion = null;
        this.bannerDismissed = false;
      }
    });

    return () => off?.();
  }

  async check(): Promise<void> {
    if (!isDesktop()) return;
    this.checking = true;
    this.toast()?.info?.("Checking for updates…");
    try {
      const status: {
        phase: string;
        stagedVersion: string | null;
        availableVersion: string | null;
        error: string | null;
      } = await getPlatform().updater.check();
      if (status.stagedVersion) {
        // An update was already downloaded + staged — the banner appears; no toast.
        this.readyVersion = status.stagedVersion;
        this.bannerDismissed = false;
      } else if (status.phase === "available") {
        // Found, not downloaded yet — the Download banner appears; tell the
        // author explicitly so a manual check reads as "found something" and
        // not "nothing happened" (M1: downloads are consented, never silent).
        this.availableVersion = status.availableVersion;
        this.bannerDismissed = false;
        this.toast()?.info?.(`Update available (v${status.availableVersion}) — use the banner to download it.`);
      } else if (status.phase === "error") {
        this.toast()?.error?.(status.error ?? "Update check failed.");
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
    this.downloading = true;
    try {
      const status: { phase: string; stagedVersion: string | null; error: string | null } =
        await getPlatform().updater.download();
      if (status.stagedVersion) {
        this.readyVersion = status.stagedVersion;
        this.availableVersion = null;
      } else if (status.phase === "error") {
        this.toast()?.error?.(status.error ?? "Update download failed.");
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
      const result = await getPlatform().updater.applyNow();
      // On success main quits, installs the update, and relaunches — this
      // code never runs. A resolved { applied: false } means the staged
      // update vanished (state drift); say so instead of silently no-oping.
      if (!result.applied) {
        this.readyVersion = null;
        this.toast()?.error?.("The update could not be applied — try checking for updates again.");
      }
    } catch (e) {
      this.toast()?.error?.(e instanceof Error ? e.message : "Could not apply update.");
    }
  }
}
