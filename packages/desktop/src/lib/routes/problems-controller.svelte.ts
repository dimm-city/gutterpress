/**
 * ProblemsController (SFE-P6a) — owns the desktop Problems panel's lint
 * findings: the debounced-by-render refresh against the open project, its
 * loading/error state, and the separately-held findings from the last PDF
 * export.
 *
 * Extracted from `+page.svelte`'s own `problems`/`buildProblemEntries`/
 * `problemsLoading`/`problemsError` state and its `refreshProblems`
 * function. What did NOT move: `openProblem` (navigating the editor to a
 * finding's file/line) and `showPreviewFiles` (opening the left panel's
 * Files tab) stay in the root — both are cross-feature coordination
 * (problems -> editor pane / left panel), which D4 keeps explicit at the
 * composition root rather than inside a feature controller. `displayedProblems`/
 * `problemBadge` also stay in the root: they merge this controller's
 * findings with `lifecycle.previewError` (a DIFFERENT feature's state),
 * which is exactly the kind of cross-feature composition the root owns.
 *
 * Host coupling is injected so this stays testable with fakes and
 * PWA-clean (§8 / ADR 0004).
 */
import type { ProblemEntry } from "$lib/platform/dtos";

export type ProblemsSourceMode = "folder" | "url";

export interface ProblemsControllerDeps {
  /** Whether the desktop host is available at all (off-Electron, this
   *  controller never fetches). */
  isDesktop: () => boolean;
  /** The currently open project dir, or null when none is open. */
  currentDir: () => string | null;
  /** The open project's source mode — only "folder" projects lint. */
  sourceMode: () => ProblemsSourceMode;
  /** Host round-trip: run the project's print-safety lint. */
  lintProject: (dir: string) => Promise<ProblemEntry[]>;
}

export class ProblemsController {
  /** Findings from the last lint refresh (source-level print-safety
   *  checks), refreshed after every live-preview rebuild. */
  entries = $state<ProblemEntry[]>([]);
  /** Findings from the last PDF export — held separately so the next lint
   *  refresh (any file save) does not wipe them; see `recordBuildEntries`. */
  buildEntries = $state<ProblemEntry[]>([]);
  /** True while a lint refresh is in flight. */
  loading = $state(false);
  /** Distinct from "entries === [] because the project is clean" — set when
   *  the lint call itself failed, so the panel can render a neutral "we
   *  couldn't check" row instead of a false green all-clear (M5). */
  error = $state<string | null>(null);

  private readonly deps: ProblemsControllerDeps;

  constructor(deps: ProblemsControllerDeps) {
    this.deps = deps;
  }

  /**
   * Re-run the project's lint and publish the result. A stale in-flight
   * lint from a project the author has since navigated away from is
   * dropped rather than clobbering the NEW project's state (M5) — every
   * write below is guarded by re-checking `currentDir()` against the `dir`
   * this call started with.
   */
  refresh(): void {
    if (!this.deps.isDesktop() || !this.deps.currentDir() || this.deps.sourceMode() !== "folder") return;
    const dir = this.deps.currentDir()!;
    this.loading = true;
    this.deps
      .lintProject(dir)
      .then((entries) => {
        if (this.deps.currentDir() === dir) {
          this.entries = entries;
          this.error = null;
        }
      })
      .catch(() => {
        // Lint failing must never break the preview, but it must also never
        // present as a false "no problems found" all-clear (M5) — surface a
        // distinct error state instead of silently clearing to [].
        if (this.deps.currentDir() === dir) {
          this.entries = [];
          this.error = "We couldn't check your project this time.";
        }
      })
      .finally(() => {
        if (this.deps.currentDir() === dir) this.loading = false;
      });
  }

  /** Records the findings from a completed PDF export (see `buildEntries`'
   *  own doc comment for why these are held separately from `entries`). */
  recordBuildEntries(entries: ProblemEntry[]): void {
    this.buildEntries = entries;
  }

  /** Clears every field — called on project close/switch (a project closed
   *  or superseded must not show its findings over the next one, or an
   *  empty workspace). */
  reset(): void {
    this.entries = [];
    this.buildEntries = [];
    this.loading = false;
    this.error = null;
  }
}
