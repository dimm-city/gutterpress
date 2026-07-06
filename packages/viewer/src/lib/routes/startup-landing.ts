// ──────────────────────────────────────────────────────────────────────────
// Start screen (welcome landing) — pure decision logic.
//
// The landing is an in-window layer shown over the workspace at launch (and
// whenever nothing is open). The previous project keeps pre-rendering BEHIND
// it exactly as it always did behind the OS splash — these helpers only decide
// when the layer shows and what its continue card says. Kept pure so the
// startup policy is unit-testable without mounting the page (same pattern as
// shortcuts.ts / preview-layout.ts).
// ──────────────────────────────────────────────────────────────────────────

export interface StartupScreenDecision {
  /** Show the start screen layer as the app's first screen. */
  showLanding: boolean;
  /** Kick off the previous project (preview render) behind it. */
  reopenLastProject: boolean;
  /**
   * Reveal the main window (rendererReady) immediately — the landing is
   * interactive right away, so the splash must not wait for the full render.
   */
  revealWindowEarly: boolean;
}

/**
 * Launch policy:
 * - No previous project → the landing IS the welcome screen.
 * - Previous project + landing enabled → show the landing AND start the
 *   previous book behind it (pre-render), revealing the window immediately.
 * - Previous project + landing disabled ("open straight to my book") → the
 *   pre-landing behavior: reopen behind the splash, reveal on render-complete.
 */
export function decideStartupScreen(opts: {
  lastProjectDir: string | null;
  landingEnabled: boolean;
}): StartupScreenDecision {
  if (!opts.lastProjectDir) {
    return { showLanding: true, reopenLastProject: false, revealWindowEarly: true };
  }
  if (!opts.landingEnabled) {
    return { showLanding: false, reopenLastProject: true, revealWindowEarly: false };
  }
  return { showLanding: true, reopenLastProject: true, revealWindowEarly: true };
}

export type ContinueStatusKind = "opening" | "rendering" | "ready";

export interface ContinueStatus {
  kind: ContinueStatusKind;
  label: string;
}

/**
 * Plain-language status line for the continue card, tracking the live
 * pre-render happening behind the landing.
 */
export function continueStatus(input: {
  hasPreviewUrl: boolean;
  rendering: boolean;
  renderProgressPage: number;
}): ContinueStatus {
  if (!input.hasPreviewUrl) {
    return { kind: "opening", label: "Opening your book…" };
  }
  if (input.rendering) {
    return {
      kind: "rendering",
      label:
        input.renderProgressPage > 0
          ? `Preparing pages — page ${input.renderProgressPage}…`
          : "Preparing your book…",
    };
  }
  return { kind: "ready", label: "Your book is ready." };
}

/**
 * The landing doubles as the app's ONLY empty state: whenever nothing is open
 * (startup with no project, a failed open, a failed URL preview), it comes
 * back so the author always has recents + create/open actions in front of
 * them. `ready` gates the very first frames on desktop until the startup
 * decision has run (the splash covers that gap), so the layer never flashes
 * before we know whether to show it.
 */
export function shouldReshowLanding(state: {
  ready: boolean;
  visible: boolean;
  busy: boolean;
  hasPreviewUrl: boolean;
  hasCurrentDir: boolean;
  hasCurrentUrl: boolean;
  hasUrlPreviewError: boolean;
}): boolean {
  if (!state.ready || state.visible) return false;
  if (state.busy || state.hasPreviewUrl || state.hasCurrentDir) return false;
  // A URL preview keeps the workspace as its error surface only while the
  // URL is still considered "open"; once it errored, the landing returns.
  if (state.hasCurrentUrl && !state.hasUrlPreviewError) return false;
  return true;
}
