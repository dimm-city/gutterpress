/**
 * ProjectSessionController (Phase 5c) — the single owner of the open project's
 * capability-classification session state that used to live inline in
 * `+page.svelte`.
 *
 * Centralises the `#12` classification wiring: on folder open the component
 * `reset()`s this state and fires `classify(dir)`, whose fire-and-forget chain
 * populates `projectCapabilities`, derives `projectSubPath` /
 * `projectSharesParentHistory` (a book opened inside a larger versioned folder),
 * persists the re-detected source hint via ViewerPrefs, re-notifies the History
 * tab, and — only when the project is actually syncable — refreshes the remote
 * diagnosis. `applyReclassify()` adopts the upgraded capabilities after version
 * history is enabled (#13). The template reads the public rune getters
 * (`projectCapabilities` / `projectSubPath` / `projectSharesParentHistory`).
 *
 * Single-owner discipline mirrors `SyncController`
 * (`sync-controller.svelte.ts`) and `PageNavController`
 * (`page-nav-controller.svelte.ts`): the component reads the runes and calls the
 * intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the host classify round-trip, the ViewerPrefs writer, and the
 * two component fan-out callbacks (`notifyHistoryRefresh` → the LeftPanel;
 * `refreshSyncDiag` → the SyncController). `ProjectClassification` /
 * `ProjectCapabilities` are type-only imports — ZERO `node:*` / lib value
 * imports.
 *
 * NOTE (deferred): the broader open/stop lifecycle and the rest of the session
 * runes (`currentDir` / `sourceMode` / `docTitle` / `currentFolderDisplayName` /
 * `currentUrl`) still live in `+page.svelte` — those ~130 references are
 * interleaved with buffer/leftPanel/pageNav side effects, so moving them
 * behaviour-preservingly is a separate item. This controller extracts the
 * cohesive, self-contained classification slice.
 */

import type { ProjectCapabilities, ProjectClassification } from "../platform/contract";

/** Loosely-typed host classify result — the api layer returns `unknown` fields. */
export type ClassifyResult = { source: unknown; capabilities: unknown };

export interface ProjectSessionDeps {
  /** Host round-trip: classify a project folder (source type + capabilities). */
  classifyProject: (dir: string) => Promise<ClassifyResult>;
  /** Persist the re-detected source hint (fire-and-forget on the component side). */
  setViewerPrefs: (prefs: Record<string, unknown>) => Promise<unknown>;
  /** Re-notify the History tab so it reloads once capabilities are known. */
  notifyHistoryRefresh: () => void;
  /** Refresh the remote diagnosis for a syncable project (SyncController). */
  refreshSyncDiag: (dir: string) => void;
}

export class ProjectSessionController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** Capabilities of the open project's source (#12), or null before classify. */
  projectCapabilities = $state<ProjectCapabilities | null>(null);
  /** The book's path relative to its shared repo ("" for standalone projects). */
  projectSubPath = $state("");
  /** True when the open folder is a book subfolder of a larger versioned folder. */
  projectSharesParentHistory = $state(false);

  private deps: ProjectSessionDeps;

  constructor(deps: ProjectSessionDeps) {
    this.deps = deps;
  }

  /**
   * Reset capability session state for a fresh open, before {@link classify}
   * repopulates it (mirrors the old inline reset at folder-open time).
   */
  reset(): void {
    this.projectCapabilities = null;
    this.projectSharesParentHistory = false;
    this.projectSubPath = "";
  }

  /**
   * Classify the opened folder (#12) so capability-gated actions (#13/#25) can
   * render. Fire-and-forget: a failure must never block the preview — it only
   * clears the capabilities.
   */
  classify(dir: string): void {
    this.deps
      .classifyProject(dir)
      .then((result) => {
        const typedResult = result as {
          source: { type: string; subPath?: string };
          capabilities: ProjectCapabilities;
        };
        this.projectCapabilities = typedResult.capabilities;
        this.projectSubPath =
          typedResult.source.type === "local-git-folder" ? (typedResult.source.subPath ?? "") : "";
        this.projectSharesParentHistory = this.projectSubPath !== "";
        this.deps
          .setViewerPrefs({ projectSource: typedResult.source } as Record<string, unknown>)
          .catch(() => {});
        // Re-notify so the History tab can load now that canHistory is set. The
        // earlier notify at folder-open time may have been a no-op because
        // projectCapabilities was still null.
        this.deps.notifyHistoryRefresh();
        // Sync gate (#15 / ADR 0006 D4): the toolbar action appears only when
        // the diagnosis says the project is actually syncable. Local reads only.
        if (typedResult.capabilities.canSync) {
          this.deps.refreshSyncDiag(dir);
        }
      })
      .catch(() => {
        this.projectCapabilities = null;
      });
  }

  /**
   * History was just enabled (#13): adopt the upgraded capabilities and persist
   * the re-classified source hint — the same shape classifyProject produces on
   * open. A capability upgrade only; subPath/shares are not recomputed here.
   */
  applyReclassify(result: ProjectClassification): void {
    this.projectCapabilities = result.capabilities;
    this.deps
      .setViewerPrefs({ projectSource: result.source } as Record<string, unknown>)
      .catch(() => {});
  }
}
