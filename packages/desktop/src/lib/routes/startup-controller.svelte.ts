/**
 * StartupController (Phase 5 slice 2) — the single owner of the launch-time
 * "reopen the last project behind the start screen" continuation that used to
 * live inline in `+page.svelte`'s startup `onMount`, extracted per UX review
 * H5 / ARCH review #10.
 *
 * `startup-landing.ts` already holds the pure predicates (`decideStartupScreen`
 * / `continueStatus` / `shouldReshowLanding`); this controller adds the
 * STATEFUL machine around them — the re-entrancy guards and the prefs
 * round-trip.
 *
 * HISTORY: this controller used to also own "when to reveal the window" —
 * the external splash window covered the main window at launch, and four
 * branches here decided when to dismiss it (`revealWindow()`/`reveal()`).
 * The splash was removed in favour of the in-window start screen
 * (WelcomeLanding): the window is simply visible from launch, so the whole
 * reveal seam is gone and this controller only decides what the first
 * SCREEN is (landing vs. reopened project).
 *
 * Host coupling is injected (§8 / ADR 0004): the prefs round-trip, the
 * left-panel-prefs application, the landing `$state` setters (still owned by
 * `+page.svelte` — they are read by `dismissLanding` / `landingVisible` /
 * `setLandingStartupPref` elsewhere on the page, so moving only their WRITERS
 * here follows the same "own only what's local to this flow" line
 * `ProjectLifecycleController` draws around `resetExtras`), and the previous-
 * project reopen pipeline. Zero `node:*` / lib value imports — PWA-clean.
 */

import { decideStartupScreen } from "./startup-landing";
import type { LastFlushFailure } from "../platform/contract";
import type { PersistedProjectState } from "./page-types";

/** The subset of persisted `DesktopPrefs` this flow reads. */
export interface StartupPrefs {
  leftPanel?: { open?: boolean; activeTab?: string; width?: number };
  showLandingAtStartup?: boolean;
  lastProjectDir?: string | null;
  lastFlushFailed?: LastFlushFailure;
}

export interface StartupControllerDeps {
  isDesktop: () => boolean;
  /**
   * Entry guard: true when the workspace already has something open,
   * opening, or erroring (preview/dir/url/busy/openError/urlPreviewError) —
   * the full check the original effect ran before doing anything at all.
   */
  isWorkspaceEngaged: () => boolean;
  /**
   * Race recheck after the prefs round-trip resolves: true when a preview,
   * folder, or URL is open, or another open intent is already busy. Errors
   * alone do not count. Including busy keeps an OS file launch that arrives
   * during the prefs read from being superseded by the previous project.
   */
  isSomethingOpen: () => boolean;
  getDesktopPrefs: () => Promise<StartupPrefs>;
  /** Surface the prior-session warning; false means no notice surface was ready. */
  showLastFlushFailure: (marker: LastFlushFailure) => boolean;
  /** Race-safe acknowledgement: the host clears only this exact marker. */
  acknowledgeFlushFailure: (failedAt: string) => Promise<unknown>;
  /** True once the left-panel prefs have been applied this session. */
  isLeftPanelPrefsLoaded: () => boolean;
  /** Apply the loaded left-panel prefs exactly once. */
  applyLeftPanelPrefs: (panelPrefs: StartupPrefs["leftPanel"]) => void;
  setLandingShowPref: (show: boolean) => void;
  setLandingReady: (ready: boolean) => void;
  setLandingHold: (hold: boolean) => void;
  setLandingContinueDir: (dir: string | null) => void;
  setBusy: (busy: boolean, label: string) => void;
  /** Per-project restore-state read, already caught-to-null by the caller. */
  getDesktopProjectState: (dir: string) => Promise<PersistedProjectState | null>;
  /** The same folder-open pipeline user-initiated opens use. */
  startFolderPreview: (
    dir: string,
    label: string,
    restoreState: Promise<PersistedProjectState | null>,
  ) => Promise<boolean>;
}

export class StartupController {
  /** True while the last-project reopen attempt is in flight (re-entrancy guard). */
  autoOpeningLastProject = $state(false);
  /** True once the startup check has run — the effect fires at most once per session. */
  lastProjectChecked = $state(false);

  private deps: StartupControllerDeps;
  constructor(deps: StartupControllerDeps) {
    this.deps = deps;
  }

  /**
   * The startup continuation: decide whether to show the landing and whether
   * to pre-render the last project behind it. Safe to call from `onMount` on
   * every launch path — the guards make every call after the first a no-op.
   * File-association launches pass `false`: startup preferences/notices still
   * initialize, but the previously-open project must not compete with the
   * chapter the OS asked the app to open.
   */
  async run(reopenLastProject = true): Promise<void> {
    const d = this.deps;
    if (!d.isDesktop()) return;
    if (this.lastProjectChecked) return;
    if (d.isWorkspaceEngaged()) return;
    if (this.autoOpeningLastProject) return;

    this.autoOpeningLastProject = true;
    this.lastProjectChecked = true;
    try {
      const prefs = await d.getDesktopPrefs();
      if (prefs.lastFlushFailed && d.showLastFlushFailure(prefs.lastFlushFailed)) {
        // Showing the persistent notice is the acknowledgement point. If the
        // atomic clear fails, retaining the marker and showing it again is safer.
        void d.acknowledgeFlushFailure(prefs.lastFlushFailed.failedAt).catch(() => {});
      }
      // Load persisted left panel state — including the open flag, which
      // applies on every launch path (the landing covers it until entry).
      if (!d.isLeftPanelPrefsLoaded()) {
        d.applyLeftPanelPrefs(prefs.leftPanel);
      }

      const showPref = prefs.showLandingAtStartup !== false;
      d.setLandingShowPref(showPref);
      d.setLandingReady(true);

      if (d.isSomethingOpen()) {
        // Something was opened while prefs loaded (rare race) — don't cover
        // it with the start screen.
        return;
      }
      if (!reopenLastProject) return;

      const dir = prefs.lastProjectDir ?? null;
      const { showLanding } = decideStartupScreen({ lastProjectDir: dir, landingEnabled: showPref });
      if (showLanding && dir) {
        // Hold the layer open over the pre-render. (With no dir the hold is
        // unnecessary: the empty workspace keeps it visible.)
        d.setLandingHold(true);
      }
      if (!dir) return;

      d.setLandingContinueDir(dir);
      // Same pipeline as user-initiated opens, EXCEPT the landing must stay
      // held over the pre-render, so this must not go through
      // openProjectPath (whose first act is dismissLanding). Raise busy and
      // hand the restore-state fetch over as a promise so the epoch is
      // claimed at intent time with no await in between (#43: per-project
      // restore keyed by folder path).
      d.setBusy(true, "Reopening previous folder…");
      const restorePromise = d.getDesktopProjectState(dir);
      await d.startFolderPreview(dir, "Reopening previous folder…", restorePromise);
      // If the saved project no longer opens (moved/renamed/deleted),
      // startFolderPreview sets openError but does NOT throw. The start
      // screen returns on its own (landingVisible derived: workspace is
      // empty again) and shows the error alongside recents and create/open
      // actions.
    } catch {
      // Prefs read failed — with landingReady set and nothing open, the
      // derived shows the start screen as the first surface instead of a
      // blank workspace.
      d.setLandingReady(true);
    } finally {
      this.autoOpeningLastProject = false;
    }
  }
}
