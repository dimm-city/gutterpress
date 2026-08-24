/**
 * SyncController (Phase 5b) — the single owner of the sync-outcome routing
 * that used to live inline in `+page.svelte`.
 *
 * Sync ALWAYS converges (no conflict outcome, no choices dialog, no chooser),
 * so this controller is the manual force-sync flow (`handleForceSync`), the
 * per-project remote diagnosis refresh (`refreshSyncDiag`), and the toasts
 * that name whatever the merge had to keep two copies of.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8 / ADR 0004). `SyncOutcome` / `ProjectRemoteDiagnosis` / `KeptBothFile`
 * are type-only imports — ZERO `node:*` / lib value imports.
 */

import type { SyncOutcome } from "../api";
import type { KeptBothFile, ProjectRemoteDiagnosis } from "../platform/contract";

/** Minimal toast surface the controller drives. */
interface SyncToast {
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

const baseName = (p: string): string => p.split("/").pop() ?? p;

/** Author-language toast for a sync that combined overlapping text edits. */
export function combinedFilesMessage(files: string[]): string {
  const names = files.map(baseName);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `Your changes and a teammate's overlapped in ${shown}${more} — both versions are kept there, marked for you to review.`;
}

/**
 * Author-language toast for files the merge could not combine in place (a
 * picture, or anything else that can't hold review marks). Both versions are
 * on disk — this names the pair so the writer can pick one by hand.
 */
export function keptBothMessage(files: KeptBothFile[]): string {
  const shown = files
    .slice(0, 3)
    .map((f) => `${baseName(f.path)} (also saved as ${baseName(f.onlinePath)})`)
    .join(", ");
  const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
  return `${shown}${more} changed in two places — nothing is lost: your version stayed put and the online version is saved beside it.`;
}

export class SyncController {
  // ── Public rune state (read by the template; mutated only via methods) ──────
  /** The remote diagnosis for the open project, or null before/while unknown. */
  syncDiag = $state<ProjectRemoteDiagnosis | null>(null);
  /** True while a manual force-sync is in flight (guards re-entry). */
  forceSyncing = $state(false);
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
   * Surface the converge-report from a completed sync (called both from
   * handleForceSync below and from the ambient sync-status subscription in
   * the component): one toast for marker-combined text files, one for files
   * kept as a side-by-side pair.
   */
  applyConvergeReport(combinedFiles?: string[], keptBothFiles?: KeptBothFile[]): void {
    if (combinedFiles && combinedFiles.length > 0) {
      this.deps.toast()?.info?.(combinedFilesMessage(combinedFiles));
    }
    if (keptBothFiles && keptBothFiles.length > 0) {
      this.deps.toast()?.info?.(keptBothMessage(keptBothFiles));
    }
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
      if (outcome.status === "synced") {
        this.deps.onSyncCompleted(outcome.mergedRemoteChanges, outcome.filesChanged === true);
        this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
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
        // targets. Details remain available via the advanced Sync surface. The
        // copy reassures that local work is safe (UX follow-up: a sync failure
        // must state what remains safe).
        this.deps.toast()?.error("Couldn't update the online copy. Your work is saved on this computer — we'll try again later.");
      }
    } catch {
      this.deps.toast()?.error("Couldn't update the online copy. Your work is saved on this computer — we'll try again later.");
    } finally {
      if (this.deps.currentDir() === dir) this.forceSyncing = false;
    }
  }
}
