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
  /**
   * Show the start screen layer as the app's first screen. When true the
   * caller also reveals the window (rendererReady) immediately — the landing
   * is interactive right away, so the splash must not wait for the render.
   * Whether the previous project reopens behind it is simply "is there a
   * lastProjectDir" — the caller already holds that value.
   */
  showLanding: boolean;
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
  return { showLanding: !opts.lastProjectDir || opts.landingEnabled };
}

type ContinueStatusKind = "opening" | "rendering" | "ready";

export interface ContinueStatus {
  kind: ContinueStatusKind;
  /**
   * Coarse, plain-language status — changes only when `kind` changes, so the
   * landing can announce it via aria-live without flooding screen readers.
   */
  label: string;
  /**
   * Per-page progress suffix (e.g. "page 42…"). Updates on every laid-out
   * page — VISUAL ONLY; the landing renders it aria-hidden.
   */
  detail: string | null;
}

/**
 * Plain-language status for the continue card, tracking the live pre-render
 * happening behind the landing.
 */
export function continueStatus(input: {
  hasPreviewUrl: boolean;
  rendering: boolean;
  renderProgressPage: number;
}): ContinueStatus {
  if (!input.hasPreviewUrl) {
    return { kind: "opening", label: "Opening your book…", detail: null };
  }
  if (input.rendering) {
    return {
      kind: "rendering",
      label: "Preparing your book…",
      detail: input.renderProgressPage > 0 ? `page ${input.renderProgressPage}…` : null,
    };
  }
  return { kind: "ready", label: "Your book is ready.", detail: null };
}

/**
 * The landing doubles as the app's ONLY empty state: whenever nothing is open
 * (startup with no project, a failed open, a failed URL preview, a canceled
 * render), it comes back so the author always has recents + create/open
 * actions in front of them. The host derives the layer's visibility from this
 * predicate over live workspace state — structural, no per-site reshow calls.
 */
export function shouldReshowLanding(state: {
  busy: boolean;
  hasPreviewUrl: boolean;
  hasCurrentDir: boolean;
  hasCurrentUrl: boolean;
  hasUrlPreviewError: boolean;
}): boolean {
  if (state.busy || state.hasPreviewUrl || state.hasCurrentDir) return false;
  // A URL preview keeps the workspace as its error surface only while the
  // URL is still considered "open"; once it errored, the landing returns.
  if (state.hasCurrentUrl && !state.hasUrlPreviewError) return false;
  return true;
}
