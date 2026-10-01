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
import type { KeptBothFile, ProjectRemoteDiagnosis, SyncState } from "../platform/contract";

/** Minimal toast surface the controller drives. */
interface SyncToast {
  success(message: string): void;
  info?(message: string): void;
  error(message: string): void;
}

export interface SyncControllerDeps {
  /** Host round-trip: run an immediate sync for the given project dir. */
  syncChanges: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: "Repair online backup" for the given project dir. */
  repair?: (dir: string) => Promise<{ outcome: SyncOutcome; restoredFiles: string[] }>;
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
  /** Settings → Saving "Keep this book backed up online". Decides whether a
   *  failure toast may promise an automatic retry. Defaults to on. */
  autoBackup?: () => boolean;
}

/**
 * The outcome of the last MANUAL "Back up now", in the ambient status
 * vocabulary. Manual syncs bypass the auto-sync orchestrator (the only emitter
 * of sync:status), so the status bar's dialog reads this to learn what a
 * manual backup just did.
 */
export interface ManualBackup {
  dir: string;
  state: SyncState;
  /** ISO time the attempt finished. */
  at: string;
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
  /** True while "Repair online backup" is in flight. */
  repairing = $state(false);
  /** The last manual backup's outcome, or null before any this session. */
  lastManual = $state<ManualBackup | null>(null);
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
    const retry = (this.deps.autoBackup?.() ?? true)
      ? "we'll try again later."
      : "try again when you're ready.";
    const failed = `Couldn't finish the online backup. Your work is saved on this computer — ${retry}`;
    const record = (state: SyncState) => {
      this.lastManual = { dir, state, at: new Date().toISOString() };
    };
    try {
      const outcome = await this.deps.syncChanges(dir);
      if (this.deps.currentDir() !== dir) return; // Project switched mid-sync.
      record(
        outcome.status === "synced" || outcome.status === "up-to-date"
          ? "synced"
          : outcome.status === "auth"
            ? "auth"
            : outcome.status === "offline"
              ? "offline"
              : "error",
      );
      if (outcome.status === "synced") {
        this.deps.onSyncCompleted(outcome.mergedRemoteChanges, outcome.filesChanged === true);
        this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
      } else if (outcome.status === "up-to-date") {
        if (outcome.filesChanged) this.deps.onSyncCompleted(false, true);
        else this.deps.toast()?.info?.("Already up to date — nothing new to back up.");
      } else if (outcome.status === "auth") {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.error("Not signed in to online backup. Use the button in Where your work is kept to sign in.");
      } else if (outcome.status === "offline") {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.info?.("You're offline. Try the online backup again when you're connected.");
      } else {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        // Error state. The lib's error-arm messages are ALL authored writer
        // copy (the MSG_* constants or an authored generic — transport.ts
        // failureOutcome; never raw git text), and some carry the actual fix
        // ("Check the book's online address"), so show them. The fixed
        // fallback covers an empty message and keeps stating what remains
        // safe (UX follow-up: a sync failure must state what remains safe).
        this.deps.toast()?.error(outcome.message || failed);
      }
    } catch {
      if (this.deps.currentDir() === dir) record("error");
      this.deps.toast()?.error(failed);
    } finally {
      if (this.deps.currentDir() === dir) this.forceSyncing = false;
    }
  }

  /**
   * "Repair online backup" (lib remote-auth/repair.ts): one fixed sequence,
   * no diagnosis. Reports through the same lastManual state the dialog reads.
   */
  async handleRepair(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.repairing || this.forceSyncing || !this.deps.repair) return;
    this.repairing = true;
    const record = (state: SyncState) => {
      this.lastManual = { dir, state, at: new Date().toISOString() };
    };
    try {
      const { outcome, restoredFiles } = await this.deps.repair(dir);
      if (this.deps.currentDir() !== dir) return;
      const ok = outcome.status === "synced" || outcome.status === "up-to-date";
      record(ok ? "synced" : outcome.status === "auth" ? "auth" : outcome.status === "offline" ? "offline" : "error");
      if (ok) {
        this.deps.toast()?.success("Online backup repaired. Your book is backed up online.");
        if (restoredFiles.length > 0) {
          this.deps.toast()?.info?.(
            `Brought back ${restoredFiles.length} file${restoredFiles.length === 1 ? "" : "s"} that only the online copy had.`,
          );
        }
        this.deps.onSyncCompleted(true, restoredFiles.length > 0 || outcome.filesChanged === true);
      } else {
        this.deps.toast()?.error(outcome.message || "The repair didn't finish. Your work is saved on this computer.");
      }
    } catch (e) {
      if (this.deps.currentDir() === dir) record("error");
      const msg = e instanceof Error ? e.message : "";
      this.deps.toast()?.error(
        msg || "The repair didn't finish. Your work is saved on this computer — see Troubleshooting → Logs for details.",
      );
    } finally {
      if (this.deps.currentDir() === dir) this.repairing = false;
    }
  }
}
