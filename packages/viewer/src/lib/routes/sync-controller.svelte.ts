/**
 * SyncController (Phase 5b) — the single owner of the sync-outcome routing and
 * conflict/diagnosis state that used to live inline in `+page.svelte`.
 *
 * Centralises the manual force-sync flow (`handleForceSync`), the ambient
 * SyncStatusPill's conflict entry point (`onPillConflict`), the per-project
 * remote diagnosis refresh (`refreshSyncDiag`), and the ConflictChoicesDialog's
 * post-resolution cleanup (`clearConflict`). Owns the public runes the template
 * binds to: `conflictOpen` / `conflictFiles` / `conflictLocalId` /
 * `conflictRemoteId` / `forceSyncing` / `syncDiag`.
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
 * `ProjectRemoteDiagnosis` / `ConflictFileInfo` are type-only imports — ZERO
 * `node:*` / lib value imports.
 */

import type { SyncOutcome } from "../api";
import type { ConflictFileInfo, ProjectRemoteDiagnosis } from "../platform/contract";

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
  conflictFiles = $state<ConflictFileInfo[]>([]);
  /** The local snapshot id backing the conflict resolution (null until fetched). */
  conflictLocalId = $state<string | null>(null);
  /** The remote snapshot id backing the conflict resolution (null until fetched). */
  conflictRemoteId = $state<string | null>(null);

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
   * a conflict state (§6.1). Opens the ConflictChoicesDialog immediately with
   * the file list from the status event, then fetches the conflict IDs
   * (localId/remoteId) via syncChanges — the only path that returns a
   * SyncOutcome carrying those IDs. The confirm button stays disabled until the
   * IDs arrive (ConflictChoicesDialog guards on !localId || !remoteId).
   */
  onPillConflict(files: ConflictFileInfo[]): void {
    const dir = this.deps.currentDir();
    if (!dir) return;
    this.conflictFiles = files;
    this.conflictLocalId = null;
    this.conflictRemoteId = null;
    this.conflictOpen = true;
    // The SyncStatus payload does not carry localId/remoteId — those are only
    // in the SyncOutcome returned by syncChanges (contract.ts lines 527-528).
    // Fetch them now so ConflictChoicesDialog.confirm() can call resolveSyncConflicts.
    this.deps
      .syncChanges(dir)
      .then((outcome: SyncOutcome) => {
        // Discard if the user switched projects or already closed the dialog.
        if (this.deps.currentDir() !== dir || !this.conflictOpen) return;
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
        }
        // auth/offline/error: leave the dialog open so the user can still
        // "Decide later"; the confirm button remains disabled.
      })
      .catch(() => {
        // Network/host error: leave the dialog open at the file list view.
        // The confirm button stays disabled; the History panel's advanced Sync
        // surface remains available as a fallback.
      });
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
        // Route through the existing conflict dialog path.
        this.conflictFiles = outcome.files;
        this.conflictLocalId = outcome.localId;
        this.conflictRemoteId = outcome.remoteId;
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
  }
}
