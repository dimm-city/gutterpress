/**
 * StartupController (Phase 5 slice 2) — the single owner of the launch-time
 * "reopen the last project behind the start screen" continuation that used to
 * live inline in `+page.svelte`'s startup `onMount`, extracted per UX review
 * H5 / ARCH review #10.
 *
 * `startup-landing.ts` already holds the pure predicates (`decideStartupScreen`
 * / `continueStatus` / `shouldReshowLanding`); this controller adds the
 * STATEFUL machine around them — the re-entrancy guards, the prefs round-trip,
 * and the decision of when to reveal the window.
 *
 * THE FIX (H5's headline defect): the inline `onMount` had the landing/prefs
 * decision call `revealWindow()` from four different branches (a race-open,
 * an enabled landing, a landing-off reopen that failed, and a prefs-read
 * failure). `revealWindow()` now has exactly ONE call site — the private
 * `reveal()` method below — mirroring how `ProjectLifecycleController`
 * collapsed the divergent hand-rolled workspace resets into the one
 * `resetWorkspace()` every teardown path calls. The four branches still each
 * decide WHETHER to reveal at that point in the flow (they must: the "enabled
 * landing" branch has to reveal the window immediately, before awaiting the
 * pre-render, or the start screen would sit uninteractive behind the splash
 * for the whole reopen — see the comment on that branch) — they just no
 * longer each own a copy of the host call. `reveal()`'s own guard is a
 * defensive invariant (this run's branches are mutually exclusive today, so
 * it is never actually hit) rather than something masking a real double-call.
 *
 * Host coupling is injected (§8 / ADR 0004): the prefs round-trip, the
 * left-panel-prefs application, the landing `$state` setters (still owned by
 * `+page.svelte` — they are read by `dismissLanding` / `landingVisible` /
 * `setLandingStartupPref` elsewhere on the page, so moving only their WRITERS
 * here follows the same "own only what's local to this flow" line
 * `ProjectLifecycleController` draws around `resetExtras`), the previous-
 * project reopen pipeline, and the splash/reveal host actions. Zero `node:*` /
 * lib value imports — PWA-clean.
 */

import { decideStartupScreen } from "./startup-landing";
import type { PersistedProjectState } from "./page-types";

/** The subset of persisted `ViewerPrefs` this flow reads. */
export interface StartupPrefs {
  leftPanel?: { open?: boolean; activeTab?: string; width?: number };
  showLandingAtStartup?: boolean;
  lastProjectDir?: string | null;
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
   * folder, or URL is already open (a narrower check than
   * `isWorkspaceEngaged` — busy/error alone don't count here, matching the
   * original inline recheck).
   */
  isSomethingOpen: () => boolean;
  /** Reveal the window / dismiss the splash. Idempotent host-side. */
  revealWindow: () => void;
  getViewerPrefs: () => Promise<StartupPrefs>;
  /** True once the left-panel prefs have been applied this session. */
  isLeftPanelPrefsLoaded: () => boolean;
  /** Apply the loaded left-panel prefs exactly once. */
  applyLeftPanelPrefs: (panelPrefs: StartupPrefs["leftPanel"]) => void;
  setLandingShowPref: (show: boolean) => void;
  setLandingReady: (ready: boolean) => void;
  setLandingHold: (hold: boolean) => void;
  setLandingContinueDir: (dir: string | null) => void;
  /** Fire-and-forget splash status update (landing-off reopen path). */
  splashStatus: (message: string, percent: number) => void;
  setBusy: (busy: boolean, label: string) => void;
  /** Per-project restore-state read, already caught-to-null by the caller. */
  getViewerProjectState: (dir: string) => Promise<PersistedProjectState | null>;
  /** The same folder-open pipeline user-initiated opens use. */
  startFolderPreview: (
    dir: string,
    label: string,
    restoreState: Promise<PersistedProjectState | null>,
  ) => Promise<void>;
  /** True when the reopen attempt above left `lifecycle.openError` set. */
  hasOpenError: () => boolean;
}

export class StartupController {
  /** True while the last-project reopen attempt is in flight (re-entrancy guard). */
  autoOpeningLastProject = $state(false);
  /** True once the startup check has run — the effect fires at most once per session. */
  lastProjectChecked = $state(false);

  private deps: StartupControllerDeps;
  private revealed = false;

  constructor(deps: StartupControllerDeps) {
    this.deps = deps;
  }

  /**
   * revealWindow()'s one call site (see the class-level doc). `revealed`
   * guards a same-run double-call defensively; today's branches are mutually
   * exclusive so it is never actually exercised.
   */
  private reveal(): void {
    if (this.revealed) return;
    this.revealed = true;
    this.deps.revealWindow();
  }

  /**
   * The startup continuation: decide whether to show the landing, whether to
   * pre-render the last project behind it, and when to reveal the window.
   * Safe to call from `onMount` on every launch path — the guards make every
   * call after the first a no-op.
   */
  async run(): Promise<void> {
    const d = this.deps;
    if (!d.isDesktop()) return;
    if (this.lastProjectChecked) return;
    if (d.isWorkspaceEngaged()) return;
    if (this.autoOpeningLastProject) return;

    this.autoOpeningLastProject = true;
    this.lastProjectChecked = true;
    try {
      const prefs = await d.getViewerPrefs();
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
        // it with the start screen; just reveal the window.
        this.reveal();
        return;
      }

      const dir = prefs.lastProjectDir ?? null;
      const { showLanding } = decideStartupScreen({ lastProjectDir: dir, landingEnabled: showPref });
      if (showLanding) {
        // Hold the layer open over the pre-render; also dismiss the splash
        // now — the start screen is interactive immediately. (With no dir
        // the hold is unnecessary: the empty workspace keeps it visible.)
        // This reveal must happen HERE, before the reopen below is awaited —
        // deferring it to a single post-await call site would leave the
        // landing sitting uninteractive behind the splash for the whole
        // reopen, defeating the point of the start screen.
        if (dir) d.setLandingHold(true);
        this.reveal();
      }
      if (!dir) return;

      d.setLandingContinueDir(dir);
      if (!showLanding) {
        // Landing disabled: pre-landing behavior — the splash covers the
        // render and rendererReady fires on render-complete.
        d.splashStatus("Opening your project…", 45);
      }
      // Same pipeline as user-initiated opens, EXCEPT the landing must stay
      // held over the pre-render, so this must not go through
      // openProjectPath (whose first act is dismissLanding). Raise busy and
      // hand the restore-state fetch over as a promise so the epoch is
      // claimed at intent time with no await in between (#43: per-project
      // restore keyed by folder path).
      d.setBusy(true, "Reopening previous folder…");
      const restorePromise = d.getViewerProjectState(dir);
      await d.startFolderPreview(dir, "Reopening previous folder…", restorePromise);
      // If the saved project no longer opens (moved/renamed/deleted),
      // startFolderPreview sets openError but does NOT throw. The start
      // screen returns on its own (landingVisible derived: workspace is
      // empty again) and shows the error alongside recents and create/open
      // actions — just make sure the window is revealed on the landing-off
      // path, where render-complete will never fire.
      if (d.hasOpenError() && !showLanding) {
        this.reveal();
      }
    } catch {
      // Prefs read failed — reveal the window; with landingReady set and
      // nothing open, the derived shows the start screen as the first
      // surface instead of a blank workspace.
      d.setLandingReady(true);
      this.reveal();
    } finally {
      this.autoOpeningLastProject = false;
    }
  }
}
