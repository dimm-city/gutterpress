/**
 * SyncController — the single owner of the online copy's outcome routing.
 *
 * Backing up ALWAYS converges (no conflict outcome, no choices dialog, no
 * chooser), so this controller is the manual Back up now flow
 * (`handleForceSync`), the per-project remote diagnosis refresh
 * (`refreshSyncDiag`), what the host's status stream last said about the open
 * book (`applyStatus`, read by the status control and Book setup → Online
 * copy), and the toasts that name whatever the merge had to keep two takes of.
 *
 * Host coupling is injected so this stays testable with fakes and PWA-clean
 * (§8). `SyncOutcome` / `ProjectRemoteDiagnosis` / `KeptBothFile`
 * are type-only imports — ZERO `node:*` / lib value imports.
 */

import type { SyncOutcome } from "../api";
import type { LastBackup } from "../backup-state";
import type { KeptBothFile, ProjectRemoteDiagnosis, SyncState, SyncStatus } from "../platform/contract";

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
  /** Host round-trip: Back up now for the given project dir. */
  syncChanges: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: "Get latest", fetch and merge the online changes without pushing. */
  getLatest: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: has the book's open revision moved online? (reads refs only; never throws) */
  checkUpdates: (dir: string) => Promise<{ available: boolean; reason?: string }>;
  /** Host round-trip: "Repair the online copy" for the given project dir. */
  repair: (dir: string) => Promise<{ outcome: SyncOutcome; restoredFiles: string[] }>;
  /** Host round-trip: diagnose the project's remote (protocol/credential/provider). */
  diagnose: (dir: string) => Promise<ProjectRemoteDiagnosis>;
  /** The currently open project dir, or null when none is open. */
  currentDir: () => string | null;
  /** The live toast surface, or null when unavailable. */
  toast: () => SyncToast | null;
  /** Backing up completed: toast.success + history refresh + optional reconcile (in the component). */
  onSyncCompleted: (mergedRemoteChanges: boolean, filesChanged: boolean) => void;
  /** Remote changes landed on disk: buffer reconcile + re-lint (in the component). */
  onFilesChanged: () => void;
  /** Settings → Saving "Back up online automatically". Decides whether a
   *  failure toast may promise an automatic retry. Defaults to on. */
  autoBackup?: () => boolean;
  /** Host round-trip: the status the host last kept for a book, read when the book opens
   *  (the push stream has no replay). */
  getStatus?: (dir: string) => Promise<SyncStatus | null>;
  /** Readers only get the latest, on their own and without a word. Defaults to an author. */
  isReader?: () => boolean;
  /**
   * Where the combined-files toast's Review button goes (the Problems list,
   * which names every passage with two takes). When absent the toast
   * has no button and the message stands alone, as before.
   */
  onReviewCombined?: () => void;
}

/**
 * The outcome of the last MANUAL "Back up now", in the ambient status
 * vocabulary. Manual passes bypass the host orchestrator (the only emitter
 * of sync:status), so `backup` reads this to learn what a manual backup just did.
 */
export interface ManualBackup {
  dir: string;
  state: SyncState;
  /** ISO time the attempt finished. */
  at: string;
}

const baseName = (p: string): string => p.split("/").pop() ?? p;

/** The newest status event the host sent for a book, and when it arrived. */
interface StreamedStatus extends LastBackup {
  dir: string;
  seenAt: number;
}

/** A pass's outcome in the ambient status vocabulary the status control reads. */
function outcomeState(outcome: SyncOutcome): SyncState {
  if (outcome.status === "synced" || outcome.status === "up-to-date") {
    // A get-latest pass leaves this computer's own versions unsent.
    return "pushDeferred" in outcome && outcome.pushDeferred ? "unsent" : "synced";
  }
  return outcome.status === "auth" || outcome.status === "offline" ? outcome.status : "error";
}

/** Author-language toast for a pass that combined overlapping text edits. */
export function combinedFilesMessage(files: string[]): string {
  const names = files.map(baseName);
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return `Two takes of a passage were kept in ${shown}${more} — yours and the online copy's. Choose which to keep in the editor.`;
}

/**
 * Author-language toast for files the merge could not combine in place (a
 * picture, or anything else that can't hold review marks). Both files are
 * on disk — this names the pair so the writer can pick one by hand.
 */
export function keptBothMessage(files: KeptBothFile[]): string {
  const shown = files
    .slice(0, 3)
    .map((f) => `${baseName(f.path)} (also saved as ${baseName(f.onlinePath)})`)
    .join(", ");
  const more = files.length > 3 ? ` and ${files.length - 3} more` : "";
  return `${shown}${more} changed in two places — nothing is lost: your file stayed put and the online copy's file is saved beside it.`;
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
  /** The newest status event for a book: the host's stream, seeded with what it kept when the book opened. */
  private streamed = $state<StreamedStatus | null>(null);
  /** The book's automatic versions keep failing (a `source: "versions"` status) until a backup pass succeeds. */
  private versionsProblemOf = $state<{ dir: string; message: string | null } | null>(null);
  /** The newest operation log the host named for a book ("Technical details" in Version history). */
  private logOf = $state<{ dir: string; path: string } | null>(null);
  private deps: SyncControllerDeps;

  constructor(deps: SyncControllerDeps) {
    this.deps = deps;
  }

  /** What the open book's online copy last did: the newer of the host's stream and the last manual Back up now. */
  get backup(): LastBackup | null {
    const dir = this.deps.currentDir();
    const s = this.streamed?.dir === dir ? this.streamed : null;
    const m = this.lastManual?.dir === dir ? this.lastManual : null;
    if (m && (!s || Date.parse(m.at) >= s.seenAt)) return { state: m.state, lastSyncAt: m.at };
    return s;
  }

  /** Why the open book's automatic versions need attention, or null when they do not. */
  get versionsProblem(): { message: string | null } | null {
    return this.versionsProblemOf?.dir === this.deps.currentDir() ? this.versionsProblemOf : null;
  }

  /** The open book's newest operation log, once the host has named one. */
  get logFile(): string | null {
    return this.logOf?.dir === this.deps.currentDir() ? this.logOf.path : null;
  }

  /** One status event from the host's stream (`SyncStatus`), for the open book only. */
  applyStatus(status: SyncStatus): void {
    if (status.projectDir !== this.deps.currentDir()) return;
    if (status.logFile) this.logOf = { dir: status.projectDir, path: status.logFile };
    if (status.source === "versions") {
      // Not a backing-up state: leave that alone.
      this.versionsProblemOf = { dir: status.projectDir, message: status.message ?? null };
      return;
    }
    this.streamed = { dir: status.projectDir, state: status.state, lastSyncAt: status.lastSyncAt, message: status.message, seenAt: Date.now() };
    // A finished pass makes a version first, so it also proves the automatic versions work again.
    if (status.state === "synced" || status.state === "unsent") this.versionsProblemOf = null;
  }

  /** The stream has no replay: read what the host kept for a book that just opened, unless a live event beat it. */
  private async seedStatus(dir: string): Promise<void> {
    const kept = await this.deps.getStatus?.(dir).catch(() => null);
    if (kept && this.streamed?.dir !== dir) this.applyStatus(kept);
  }

  async refreshSyncDiag(dir: string): Promise<void> {
    this.updatesAvailable = false;
    if (this.streamed?.dir !== dir) void this.seedStatus(dir);
    // A sign-in that was just saved answers a "didn't accept the saved sign-in".
    else if (this.streamed.state === "auth" || this.streamed.state === "connect") this.streamed = null;
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
   * discovery. Only while automatic backing up is off (it gets them on its own
   * every few minutes), only for a book that can back up, and never for a
   * reader (who gets them quietly either way). Quiet on every failure: the
   * next check, or the author's own Get latest, tries again.
   */
  async checkForUpdates(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || !this.syncDiag?.canSync || (this.deps.autoBackup?.() ?? true) || this.deps.isReader?.()) return;
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
   * has something to merge), and overlaps are combined as in any backing up.
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
        this.recordManual(dir, outcomeState(outcome));
        const merged = outcome.status === "synced" && outcome.mergedRemoteChanges;
        if (merged || outcome.filesChanged) {
          this.deps.onFilesChanged();
          this.deps.toast()?.success("Got the latest changes from the online copy.");
          this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
        } else {
          this.deps.toast()?.info?.("Already up to date — nothing new online.");
        }
      } else if (outcome.status === "auth") {
        this.deps.toast()?.error("Not signed in to the online copy. Sign in from Book setup → Online copy.");
      } else if (outcome.status === "offline") {
        this.deps.toast()?.info?.("Couldn't reach the online copy. Check your internet connection, or try again later.");
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
   * Surface the converge-report from a completed pass (called both from
   * handleForceSync below and from the ambient status subscription in
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
   * Back up the open project now.
   * Reuses the same syncChanges() path the auto-orchestrator uses.
   * Only callable when the project canSync (guarded in StatusBar via showManualSync).
   */
  async handleForceSync(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.forceSyncing) return;
    this.forceSyncing = true;
    const retry = (this.deps.autoBackup?.() ?? true)
      ? "we'll try again later."
      : "try again when you're ready.";
    const failed = `Couldn't finish backing up. Your work is saved on this computer — ${retry}`;
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
        this.deps.toast()?.error("Not signed in to the online copy. Sign in from Book setup → Online copy.");
      } else if (outcome.status === "offline") {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        this.deps.toast()?.info?.("Couldn't reach the online copy. Check your internet connection, or try again later.");
      } else {
        if (outcome.filesChanged) this.deps.onFilesChanged();
        // Error state. The lib's error-arm messages are ALL authored writer
        // copy (the MSG_* constants or an authored generic — transport.ts
        // failureOutcome; never raw git text), and some carry the actual fix
        // ("Check the book's online address"), so show them. The fixed
        // fallback covers an empty message and keeps stating what remains
        // safe (a failure must state what remains safe).
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
   * "Repair the online copy" (lib remote-auth/repair.ts): one fixed sequence,
   * no diagnosis. Re-entry is guarded by the Online copy tab's own "running" phase.
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
          ? `Online copy repaired, and ${n} file${n === 1 ? "" : "s"} only the online copy had ${n === 1 ? "is" : "are"} back.`
          : "Online copy repaired. Your book is backed up.",
      );
      this.deps.onSyncCompleted(true, n > 0 || outcome.filesChanged === true);
    } catch {
      if (this.deps.currentDir() === dir) this.recordManual(dir, "error");
      this.deps.toast()?.error(failed);
    }
  }
}
