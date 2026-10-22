/**
 * SyncController — the single owner of the sync-outcome routing.
 *
 * Sync ALWAYS converges (no conflict outcome, no choices dialog, no chooser),
 * so this controller is the manual force-sync flow (`handleForceSync`), the
 * per-project remote diagnosis refresh (`refreshSyncDiag`), and the toasts
 * that name whatever the merge had to keep two copies of.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8). `SyncOutcome` / `ProjectRemoteDiagnosis` / `KeptBothFile`
 * are type-only imports — ZERO `node:*` / lib value imports.
 */

import type { SyncOutcome } from "../api";
import type { KeptBothFile, ProjectRemoteDiagnosis, SyncState } from "../platform/contract";

/** Minimal toast surface the controller drives. */
interface SyncToast {
  success(message: string): void;
  info?(message: string): void;
  error(message: string): void;
  /** A toast with one action button (the "new changes online" prompt). */
  show?(message: string, type?: "info", duration?: number, action?: { label: string; onClick: () => void }): void;
}

/** How often to look for new online changes while automatic backup is off. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface SyncControllerDeps {
  /** Host round-trip: run an immediate sync for the given project dir. */
  syncChanges: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: "Get latest", fetch and merge the online changes without pushing. */
  getLatest: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: has the book's branch moved online? (reads refs only; never throws) */
  checkUpdates: (dir: string) => Promise<{ available: boolean; reason?: string }>;
  /** Host round-trip: "Repair online backup" for the given project dir. */
  repair: (dir: string) => Promise<{ outcome: SyncOutcome; restoredFiles: string[] }>;
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
  /**
   * Where the combined-files toast's Review button goes (the Problems list,
   * which names every passage with two versions). When absent the toast
   * has no button and the message stands alone, as before.
   */
  onReviewCombined?: () => void;
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

/** A sync outcome in the ambient status vocabulary the dialog reads. */
function outcomeState(outcome: SyncOutcome): SyncState {
  if (outcome.status === "synced" || outcome.status === "up-to-date") return "synced";
  return outcome.status === "auth" || outcome.status === "offline" ? outcome.status : "error";
}

/** Author-language toast for a sync that combined overlapping text edits. */
export function combinedFilesMessage(files: string[]): string {
  const names = files.map(baseName);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `Two versions of a passage were kept in ${shown}${more} — yours and the online version. Choose which to keep in the editor.`;
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
  /** The last manual backup's outcome, or null before any this session. */
  lastManual = $state<ManualBackup | null>(null);
  /** True while a manual "Get latest" is in flight. */
  gettingLatest = $state(false);
  /** The online copy has changes this one has not got (last check said so). */
  updatesAvailable = $state(false);
  private deps: SyncControllerDeps;

  constructor(deps: SyncControllerDeps) {
    this.deps = deps;
  }

  async refreshSyncDiag(dir: string): Promise<void> {
    this.updatesAvailable = false;
    try {
      const diag = await this.deps.diagnose(dir);
      // Project may have changed while the diagnosis was in flight.
      if (this.deps.currentDir() !== dir) return;
      this.syncDiag = diag;
      void this.checkForUpdates();
    } catch {
      this.syncDiag = null;
    }
  }

  /**
   * Look for changes online the author has not got, and prompt once per
   * discovery. Only while automatic backup is off (automatic backup gets them
   * on its own every few minutes) and only for a book that can sync. Quiet on
   * every failure: the next check, or the author's own Get latest, tries again.
   */
  async checkForUpdates(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || !this.syncDiag?.canSync || (this.deps.autoBackup?.() ?? true)) return;
    if (this.forceSyncing || this.gettingLatest) return;
    let result: { available: boolean; reason?: string };
    try {
      result = await this.deps.checkUpdates(dir);
    } catch {
      return;
    }
    if (this.deps.currentDir() !== dir || result.reason) return;
    const discovered = result.available && !this.updatesAvailable;
    this.updatesAvailable = result.available;
    if (discovered) {
      const t = this.deps.toast();
      const message = "New changes are online for this book.";
      if (t?.show) t.show(message, "info", 0, { label: "Get latest", onClick: () => void this.handleGetLatest() });
      else t?.info?.(`${message} Use Get latest to bring them in.`);
    }
  }

  /**
   * Check now, then every UPDATE_CHECK_INTERVAL_MS and whenever the window
   * comes back into focus. Returns the cleanup.
   */
  watchForUpdates(win: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
    const check = () => void this.checkForUpdates();
    const timer = setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    win.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      win.removeEventListener("focus", check);
    };
  }

  /**
   * "Get latest": bring in the online changes without sending anything back.
   * Unsaved-to-history edits are kept (the lib saves a version first when it
   * has something to merge), and overlaps are combined as in any sync.
   */
  async handleGetLatest(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.gettingLatest || this.forceSyncing) return;
    this.gettingLatest = true;
    const failed = "Couldn't get the latest changes. Your work is saved on this computer — try again when you're ready.";
    try {
      const outcome = await this.deps.getLatest(dir);
      if (this.deps.currentDir() !== dir) return;
      if (outcome.status === "synced" || outcome.status === "up-to-date") {
        this.updatesAvailable = false;
        const merged = outcome.status === "synced" && outcome.mergedRemoteChanges;
        if (merged || outcome.filesChanged) {
          this.deps.onFilesChanged();
          this.deps.toast()?.success("Got the latest changes from online.");
          this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
        } else {
          this.deps.toast()?.info?.("Already up to date — nothing new online.");
        }
      } else if (outcome.status === "auth") {
        this.deps.toast()?.error("Not signed in to online backup. Use the button in Where your work is kept to sign in.");
      } else if (outcome.status === "offline") {
        this.deps.toast()?.info?.("You're offline. Try again when you're connected.");
      } else {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.error(outcome.message || failed);
      }
    } catch {
      this.deps.toast()?.error(failed);
    } finally {
      if (this.deps.currentDir() === dir) this.gettingLatest = false;
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
      const t = this.deps.toast();
      const message = combinedFilesMessage(combinedFiles);
      const review = this.deps.onReviewCombined;
      // Sticky (duration 0) when it carries the way in, like the "new changes
      // online" prompt: the author decides when they have seen it.
      if (review && t?.show) t.show(message, "info", 0, { label: "Review", onClick: review });
      else t?.info?.(message);
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
    try {
      const outcome = await this.deps.syncChanges(dir);
      if (this.deps.currentDir() !== dir) return; // Project switched mid-sync.
      this.recordManual(dir, outcomeState(outcome));
      if (outcome.status === "synced" || outcome.status === "up-to-date") this.updatesAvailable = false;
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
        // safe (a sync failure must state what remains safe).
        this.deps.toast()?.error(outcome.message || failed);
      }
    } catch {
      if (this.deps.currentDir() === dir) this.recordManual(dir, "error");
      this.deps.toast()?.error(failed);
    } finally {
      if (this.deps.currentDir() === dir) this.forceSyncing = false;
    }
  }

  private recordManual(dir: string, state: SyncState): void {
    this.lastManual = { dir, state, at: new Date().toISOString() };
  }

  /**
   * "Repair online backup" (lib remote-auth/repair.ts): one fixed sequence,
   * no diagnosis. Re-entry is guarded by the dialog's own "running" phase.
   */
  async handleRepair(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.forceSyncing) return;
    const failed = "The repair didn't finish. Your work is saved on this computer — see Troubleshooting → Logs for details.";
    try {
      const { outcome, restoredFiles } = await this.deps.repair(dir);
      if (this.deps.currentDir() !== dir) return;
      const state = outcomeState(outcome);
      this.recordManual(dir, state);
      if (state !== "synced") {
        this.deps.toast()?.error(outcome.message || failed);
        return;
      }
      const n = restoredFiles.length;
      this.deps.toast()?.success(
        n > 0
          ? `Online backup repaired, and ${n} file${n === 1 ? "" : "s"} only the online copy had ${n === 1 ? "is" : "are"} back.`
          : "Online backup repaired. Your book is backed up online.",
      );
      this.deps.onSyncCompleted(true, n > 0 || outcome.filesChanged === true);
    } catch {
      if (this.deps.currentDir() === dir) this.recordManual(dir, "error");
      this.deps.toast()?.error(failed);
    }
  }
}
