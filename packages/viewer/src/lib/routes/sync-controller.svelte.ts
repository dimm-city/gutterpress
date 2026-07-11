/**
 * SyncController (Phase 5b) — the single owner of the sync-outcome routing and
 * conflict/diagnosis state that used to live inline in `+page.svelte`.
 *
 * Centralises the manual force-sync flow (`handleForceSync`), the ambient
 * SyncStatusPill's conflict entry point (`onPillConflict`), the per-project
 * remote diagnosis refresh (`refreshSyncDiag`), and the ConflictChoicesDialog's
 * post-resolution cleanup (`clearConflict`). Owns the public runes the template
 * binds to: `conflictOpen` / `conflictFiles` / `conflictLocalId` /
 * `conflictRemoteId` / `conflictPending` / `conflictFetchFailed` /
 * `forceSyncing` / `syncDiag`.
 *
 * Single-owner discipline mirrors `ExportController`
 * (`export/export-controller.svelte.ts`) and `PageNavController`
 * (`page-nav-controller.svelte.ts`): the component reads the public rune getters
 * and calls the intent methods.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004): the two host round-trips (`syncChanges`, `diagnose`), the
 * `currentDir` accessor, the `toast` surface accessor, and the two component
 * callbacks the outcome routing fans out to — `onSyncCompleted` (toast.success +
 * history refresh + optional reconcile, in the component) and `onFilesChanged`
 * (buffer reconcile + re-lint, in the component). `SyncOutcome` /
 * `ProjectRemoteDiagnosis` / `ConflictFileEntry` are type-only imports — ZERO
 * `node:*` / lib value imports.
 *
 * M13 (2026-07-10 UX review): `onPillConflict` used to ALWAYS run a second
 * network sync just to fetch `localId`/`remoteId` — the dialog opened with a
 * silently-disabled primary button until that call landed, and swallowed a
 * failure, leaving the button dead forever with no explanation. Most conflict
 * emit sites (see `auto-sync/orchestrator.ts`) now carry the ids directly on
 * the `SyncStatus` payload, so `onPillConflict` takes them as parameters and
 * skips the fetch entirely when present. The fetch survives ONLY as a fallback
 * for emit sites that cannot compute ids (the repair-driven conflict path —
 * see `recovery-emit.ts`'s `needs_user` branch), gated behind an explicit
 * `conflictPending` state, with `conflictFetchFailed` + `retryConflictIds()`
 * covering the failure the old code used to swallow.
 */

import type { SyncOutcome } from "../api";
import type { ConflictFileEntry, ProjectRemoteDiagnosis } from "../platform/contract";

/** Minimal toast surface the controller drives (success is fired by the injected component callback). */
export interface SyncToast {
  success(message: string): void;
  info?(message: string): void;
  error(message: string): void;
}

export interface SyncControllerDeps {
  /** Host round-trip: run an immediate sync for the given project dir. */
  syncChanges: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: diagnose the project's remote (protocol/credential/provider). */
  diagnose: (dir: string) => Promise<ProjectRemoteDiagnosis>;
  /** The currently open project dir, or null when none is open. */
  currentDir: () => string | null;
  /** The live toast surface, or null when unavailable. */
  toast: () => SyncToast | null;
  /** Sync completed: toast.success + history refresh + optional reconcile (in the component). */
  onSyncCompleted: (mergedRemoteChanges: boolean, filesChanged: boolean) => void;
  /** Remote changes landed on disk: buffer reconcile + re-lint (in the component). */
  onFilesChanged: () => void;
}

export class SyncController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The remote diagnosis for the open project, or null before/while unknown. */
  syncDiag = $state<ProjectRemoteDiagnosis | null>(null);
  /** True while a manual force-sync is in flight (guards re-entry). */
  forceSyncing = $state(false);
  /** True while the ConflictChoicesDialog is open. */
  conflictOpen = $state(false);
  /** The conflicting files shown in the dialog. */
  conflictFiles = $state<ConflictFileEntry[]>([]);
  /** The local snapshot id backing the conflict resolution (null until fetched). */
  conflictLocalId = $state<string | null>(null);
  /** The remote snapshot id backing the conflict resolution (null until fetched). */
  conflictRemoteId = $state<string | null>(null);
  /**
   * True while the fallback ids fetch is in flight (M13) — ONLY entered when
   * the conflict emit site did not carry `localId`/`remoteId` on the
   * `SyncStatus` payload. Drives ConflictChoicesDialog's "Getting things
   * ready…" state.
   */
  conflictPending = $state(false);
  /**
   * True when the fallback ids fetch failed or came back unresolved (M13).
   * Drives ConflictChoicesDialog's in-dialog retry affordance instead of
   * leaving the primary button silently dead forever.
   */
  conflictFetchFailed = $state(false);

  private deps: SyncControllerDeps;

  constructor(deps: SyncControllerDeps) {
    this.deps = deps;
  }

  async refreshSyncDiag(dir: string): Promise<void> {
    try {
      const diag = await this.deps.diagnose(dir);
      // Project may have changed while the diagnosis was in flight.
      if (this.deps.currentDir() === dir) this.syncDiag = diag;
    } catch {
      this.syncDiag = null;
    }
  }

  /**
   * Called by the ambient SyncStatusPill when the auto-sync orchestrator emits
   * a conflict state (§6.1), with the `localId`/`remoteId` from that SAME
   * SyncStatus payload when the emitting host path could compute them (M13 —
   * see the doc comment on `SyncStatus` in `platform/contract.ts`). When both
   * are present this is the ENTIRE method: no network round-trip, and the
   * primary button unlocks immediately.
   *
   * Only when ids are absent (a conflict emit site that cannot compute them,
   * e.g. the repair-driven path) does this fall back to fetching them via
   * `syncChanges` — the only OTHER path that returns a SyncOutcome carrying
   * those ids — while `conflictPending` drives an explicit "Getting things
   * ready…" state, and `conflictFetchFailed` (+ `retryConflictIds`) replaces
   * the old silent swallow-and-die-forever behavior on failure.
   */
  onPillConflict(files: ConflictFileEntry[], localId?: string, remoteId?: string): void {
    const dir = this.deps.currentDir();
    if (!dir) return;
    this.conflictFiles = files;
    this.conflictOpen = true;
    if (localId && remoteId) {
      // Fast path (M13): the SyncStatus payload already carried the ids.
      this.conflictLocalId = localId;
      this.conflictRemoteId = remoteId;
      this.conflictPending = false;
      this.conflictFetchFailed = false;
      return;
    }
    this.conflictLocalId = null;
    this.conflictRemoteId = null;
    this.fetchConflictIds(dir);
  }

  /**
   * Fallback ids fetch (M13): only reached when the conflict emit site that
   * opened the dialog did not carry `localId`/`remoteId`. Also the
   * implementation behind `retryConflictIds()`.
   */
  private fetchConflictIds(dir: string): void {
    this.conflictPending = true;
    this.conflictFetchFailed = false;
    this.deps
      .syncChanges(dir)
      .then((outcome: SyncOutcome) => {
        // Discard if the user switched projects or already closed the dialog.
        if (this.deps.currentDir() !== dir || !this.conflictOpen) return;
        this.conflictPending = false;
        if (outcome.status === "conflict") {
          this.conflictFiles = outcome.files;
          this.conflictLocalId = outcome.localId;
          this.conflictRemoteId = outcome.remoteId;
        } else if (outcome.status === "synced") {
          // Conflict resolved on its own (race between pill event + sync call).
          this.conflictOpen = false;
          this.deps.onSyncCompleted(outcome.mergedRemoteChanges, outcome.filesChanged === true);
        } else if (outcome.status === "up-to-date") {
          this.conflictOpen = false;
          this.deps.onSyncCompleted(false, outcome.filesChanged === true);
        } else {
          // auth/offline/error: nothing more we can do automatically. Surface
          // the failure (M13) instead of leaving the primary button silently
          // disabled with no explanation — the dialog offers a retry.
          this.conflictFetchFailed = true;
        }
      })
      .catch(() => {
        // Network/host error: surface it (M13) rather than swallowing it.
        if (this.deps.currentDir() !== dir || !this.conflictOpen) return;
        this.conflictPending = false;
        this.conflictFetchFailed = true;
      });
  }

  /**
   * Retry the fallback ids fetch after a failure. Wired to
   * ConflictChoicesDialog's "Try again" affordance in the pending/failed
   * state (M13) — distinct from `confirm()`'s own retry, which re-runs
   * `resolveSyncConflicts` once ids are already known.
   */
  retryConflictIds(): void {
    const dir = this.deps.currentDir();
    if (!dir || !this.conflictOpen) return;
    this.fetchConflictIds(dir);
  }

  /**
   * Trigger an immediate sync for the open project.
   * Reuses the same syncChanges() path the auto-orchestrator uses.
   * Only callable when the project canSync (guarded in StatusBar via showForceSync).
   */
  async handleForceSync(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.forceSyncing) return;
    this.forceSyncing = true;
    try {
      const outcome = await this.deps.syncChanges(dir);
      if (this.deps.currentDir() !== dir) return; // Project switched mid-sync.
      if (outcome.status === "conflict") {
        // Route through the existing conflict dialog path. This SyncOutcome
        // always carries localId/remoteId directly, so there is no pending
        // fallback state to enter here (M13).
        this.conflictFiles = outcome.files;
        this.conflictLocalId = outcome.localId;
        this.conflictRemoteId = outcome.remoteId;
        this.conflictPending = false;
        this.conflictFetchFailed = false;
        this.conflictOpen = true;
      } else if (outcome.status === "synced") {
        this.deps.onSyncCompleted(outcome.mergedRemoteChanges, outcome.filesChanged === true);
      } else if (outcome.status === "up-to-date") {
        if (outcome.filesChanged) this.deps.onSyncCompleted(false, true);
        else this.deps.toast()?.info?.("Already up to date — no changes to sync.");
      } else if (outcome.status === "auth") {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.error("Not connected. Use Connect in the sidebar to set up syncing.");
      } else if (outcome.status === "offline") {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.info?.("You appear to be offline. Try again when connected.");
      } else {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        // Generic error state. Deliberately a friendly fixed string, NOT
        // outcome.message: that field carries raw git/network error text that is
        // unhelpful (and often alarming) to the non-technical authors this app
        // targets. Details remain available via the advanced Sync surface.
        this.deps.toast()?.error("Sync failed. Check your connection and try again.");
      }
    } catch (e) {
      this.deps.toast()?.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (this.deps.currentDir() === dir) this.forceSyncing = false;
    }
  }

  /** ConflictChoicesDialog onResolved cleanup: reset files/ids (leaves conflictOpen to the bind). */
  clearConflict(): void {
    this.conflictFiles = [];
    this.conflictLocalId = null;
    this.conflictRemoteId = null;
    this.conflictPending = false;
    this.conflictFetchFailed = false;
  }
}
