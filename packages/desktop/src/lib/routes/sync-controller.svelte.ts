/**
 * SyncController — the single owner of the online copy's outcome routing.
 *
 * Backing up ALWAYS converges (no conflict outcome, no choices dialog, no
 * chooser), so this controller is the manual passes — Sync and Back up now
 * (`handleForceSync`: get the latest, then back up) and Get latest
 * (`handleGetLatest`: get the latest, send nothing) — the per-project remote
 * diagnosis refresh (`refreshSyncDiag`), what the host's status stream last
 * said about the open book (`applyStatus`, read by the status control and
 * Book setup → Online copy), and the toasts that name whatever the merge had
 * to keep two takes of.
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
  /**
   * A toast with an optional action button, and an optional `key`: a toast with
   * the same key is replaced in place instead of stacking.
   */
  show?(
    message: string,
    type?: "info" | "success" | "error",
    duration?: number,
    action?: { label: string; onClick: () => void },
    key?: string,
  ): void;
  /** Take away the toast with this key, if it is still up. */
  dismissKey?(key: string): void;
}

/** One outcome toast per author action, and one for "new changes online": a newer one replaces the older. */
const OUTCOME_KEY = "sync-outcome";
const NEW_ONLINE_KEY = "new-online";
/** The host's own passes (the status stream) report their two takes under this key. */
const CONVERGE_AMBIENT_KEY = "converge-ambient";

/** A host `syncing` this soon after the instant local answer is the pass that confirms it, not news. */
export const LOCAL_ANSWER_QUIET_MS = 3000;

/** How often to look for new online changes while automatic backup is off. */
export const UPDATE_CHECK_INTERVAL_MS = 5 * 60_000;

export interface SyncControllerDeps {
  /** Host round-trip: a full pass (get the latest, then back up) for the given project dir. */
  syncChanges: (dir: string) => Promise<SyncOutcome>;
  /** Host round-trip: "Get latest", the same pass with `push: false`: fetch and merge, never send; `bringInMainDraft` also combines the online Main draft (#524). */
  getLatest: (dir: string, options?: { bringInMainDraft?: boolean }) => Promise<SyncOutcome>;
  /** Host round-trip: has the book's open revision moved online? (reads refs only; never throws) */
  checkUpdates: (dir: string) => Promise<{ available: boolean; reason?: string; host?: string }>;
  /** Host round-trip: "Repair the online copy" for the given project dir. */
  repair: (dir: string) => Promise<{ outcome: SyncOutcome; restoredFiles: string[]; movedGitTo?: string }>;
  /** Host round-trip: diagnose the project's remote (protocol/credential/provider). */
  diagnose: (dir: string) => Promise<ProjectRemoteDiagnosis>;
  /** The currently open project dir, or null when none is open. */
  currentDir: () => string | null;
  /** The live toast surface, or null when unavailable. */
  toast: () => SyncToast | null;
  /** Backing up completed: toast.success + history refresh + optional reconcile (in the component). */
  onSyncCompleted: (mergedRemoteChanges: boolean, filesChanged: boolean, quiet?: boolean) => void;
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
 * The outcome of the last MANUAL pass (Sync, Back up now, Get latest), in the ambient status
 * vocabulary. Manual passes bypass the host orchestrator (the only emitter
 * of sync:status), so `backup` reads this to learn what a manual backup just did.
 */
export interface ManualBackup {
  dir: string;
  state: SyncState | "not-found";
  /** ISO time the attempt finished. */
  at: string;
  /** `github` when the online copy is on GitHub (kept so the "Sign in again" secondary still shows). */
  host?: string;
}

/** A state that is a problem to fix, not an answer: a later good check or a sign-in clears it. */
const FAILURE_STATES: ReadonlySet<string> = new Set(["offline", "auth", "not-found"]);

const baseName = (p: string): string => p.split("/").pop() ?? p;

/** The newest status event the host sent for a book, and when it arrived. */
interface StreamedStatus extends LastBackup {
  dir: string;
  seenAt: number;
}

/** A pass's outcome in the ambient status vocabulary the status control reads. */
function outcomeState(outcome: SyncOutcome): SyncState | "not-found" {
  // The host reports an online copy that is gone as "not-found" (it was "auth" before).
  if ((outcome.status as string) === "not-found") return "not-found";
  if (outcome.status === "synced" || outcome.status === "up-to-date") {
    // A Get latest pass leaves this computer's own versions unsent.
    return outcome.status === "up-to-date" && outcome.pushDeferred ? "unsent" : "synced";
  }
  return outcome.status === "auth" || outcome.status === "offline" ? outcome.status : "error";
}

/**
 * Author-language toast for a pass that combined overlapping text edits. No
 * file names: the status bar says how many passages are waiting, and Review
 * opens the list that names them.
 */
export function combinedFilesMessage(_files: string[]): string {
  return "New changes came in. Some passages were changed in both places. Choose which to keep.";
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

const NOT_SIGNED_IN = "Not signed in to the online copy. Sign in to keep sending changes.";
const OFFLINE = "Couldn't reach the online copy. Check your internet connection, or try again later.";

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
  /** The book whose online changes this session has checked for at least once (manual mode's first real answer). */
  checkedDir = $state<string | null>(null);
  /** When a pass last wrote files into the book (the host's or a manual one), so the editor's reload after it stays quiet. */
  private filesWrittenAt = 0;
  /** When the host's own pass last said "syncing" and has not yet sent its final status (0 = none running). */
  private hostPassStartedAt = 0;
  /** True while a pass is running, or just wrote files: a reload then is that pass's own doing. */
  get passTouchedFiles(): boolean {
    const hostPass = this.hostPassStartedAt > 0 && Date.now() - this.hostPassStartedAt < 120_000;
    return this.forceSyncing || this.gettingLatest || hostPass || Date.now() - this.filesWrittenAt < 10_000;
  }
  /** A pass wrote files into the book (called for the host's own passes too). */
  noteFilesWritten(): void {
    this.filesWrittenAt = Date.now();
  }
  /** The book's automatic versions keep failing (a `source: "versions"` status) until a backup pass succeeds. */
  private versionsProblemOf = $state<{ dir: string; message: string | null } | null>(null);
  /** The newest operation log the host named for a book ("Technical details" in Version history). */
  private logOf = $state<{ dir: string; path: string } | null>(null);
  private deps: SyncControllerDeps;

  constructor(deps: SyncControllerDeps) {
    this.deps = deps;
  }

  /** What the open book's online copy last did: the newer of the host's stream and the last manual pass. */
  get backup(): LastBackup | null {
    const dir = this.deps.currentDir();
    const s = this.streamed?.dir === dir ? this.streamed : null;
    const m = this.lastManual?.dir === dir ? this.lastManual : null;
    if (m && (!s || Date.parse(m.at) >= s.seenAt)) return { state: m.state, lastSyncAt: m.at, ...(m.host ? { host: m.host } : {}) };
    // The host's status may not carry a time (none has run in its session): a manual pass that backed up can
    // (a failed one has no backup time to lend).
    if (s && !s.lastSyncAt && m?.state === "synced") return { ...s, lastSyncAt: m.at };
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
    // WP-C's fields, all optional: absent from an older host.
    const extra = status as unknown as { ahead?: number; behind?: boolean; decide?: number; source?: string; reason?: string; host?: string };
    // The first network pass right after an instant local "Backed up" usually just confirms it:
    // keep the answer on screen instead of flashing "Backing up…" (the pass's own result replaces it).
    // Only a `syncing` that comes straight after it (the orchestrator's first pass starts about a second
    // after open): a later one is a real pass, and a real push must show.
    // The host's pass may pull changes and reload the editor before its final status arrives: note it
    // running before the guard below can return, and clear it on the terminal status.
    this.hostPassStartedAt = status.state === "syncing" ? Date.now() : 0;
    const prev = this.streamed;
    if (
      status.state === "syncing" &&
      prev?.dir === status.projectDir &&
      prev.local &&
      prev.state === "synced" &&
      Date.now() - prev.seenAt < LOCAL_ANSWER_QUIET_MS
    ) {
      return;
    }
    this.streamed = {
      dir: status.projectDir,
      state: status.state,
      lastSyncAt: status.lastSyncAt,
      message: status.message,
      seenAt: Date.now(),
      ...(typeof extra.ahead === "number" ? { ahead: extra.ahead } : {}),
      ...(typeof extra.behind === "boolean" ? { behind: extra.behind } : {}),
      ...(typeof extra.decide === "number" ? { decide: extra.decide } : {}),
      ...(extra.source === "local" ? { local: true } : {}),
      ...(typeof extra.reason === "string" ? { reason: extra.reason } : {}),
      ...(typeof extra.host === "string" ? { host: extra.host } : {}),
    };
    // The host knows the online copy has moved on (or has not): keep the Update button's cue in step.
    if (typeof extra.behind === "boolean") this.updatesAvailable = extra.behind;
    // A finished pass makes a version first, so it also proves the automatic versions work again.
    if ((status.state === "synced" || status.state === "unsent") && status.source !== "local") this.versionsProblemOf = null;
  }

  /** The stream has no replay: read what the host kept for a book that just opened, unless a live event beat it. */
  private async seedStatus(dir: string): Promise<void> {
    const kept = await this.deps.getStatus?.(dir).catch(() => null);
    if (kept && this.streamed?.dir !== dir) this.applyStatus(kept);
  }

  async refreshSyncDiag(dir: string): Promise<void> {
    this.updatesAvailable = false;
    if (this.checkedDir !== dir) this.checkedDir = null;
    if (this.streamed?.dir !== dir) void this.seedStatus(dir);
    // A sign-in that was just saved answers a "didn't accept the saved sign-in".
    else if (this.streamed.state === "auth" || this.streamed.state === "connect") this.streamed = null;
    if (this.lastManual?.dir === dir && this.lastManual.state === "auth") this.lastManual = null;
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
   * next check, or the author's own Get latest or Sync, tries again.
   */
  async checkForUpdates(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || !this.syncDiag?.canSync || (this.deps.autoBackup?.() ?? true) || this.deps.isReader?.()) return;
    if (this.forceSyncing || this.gettingLatest) return;
    let result: { available: boolean; reason?: string; host?: string };
    try {
      result = await this.deps.checkUpdates(dir);
    } catch {
      return;
    }
    if (this.deps.currentDir() !== dir) return;
    // Any answer is an answer: record it, so the bar stops saying "Checking online…". An offline or
    // rejected check is also the online copy's latest word, in place of an older local one.
    this.checkedDir = dir;
    if (result.reason === "offline" || result.reason === "auth" || result.reason === "not-found") {
      this.recordManual(dir, result.reason, result.host);
      return;
    }
    if (result.reason) return;
    // A good answer: an earlier "offline" or "can't find" from a check no longer holds.
    if (this.lastManual?.dir === dir && FAILURE_STATES.has(this.lastManual.state)) this.lastManual = null;
    const discovered = result.available && !this.updatesAvailable;
    this.updatesAvailable = result.available;
    if (!result.available) this.deps.toast()?.dismissKey?.(NEW_ONLINE_KEY);
    if (discovered) {
      const t = this.deps.toast();
      const message = "New changes are online for this book.";
      if (t?.show) t.show(message, "info", 0, { label: "Get changes", onClick: () => void this.handleGetLatest() }, NEW_ONLINE_KEY);
      else t?.info?.(`${message} Use the Update button to bring them in.`);
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
   * The outcome toast for an author action. One at a time: a newer outcome
   * replaces the last instead of stacking (a toast surface without `show`
   * falls back to its plain methods).
   */
  private notify(kind: "success" | "info" | "error", message: string, action?: { label: string; onClick: () => void }): void {
    const t = this.deps.toast();
    if (!t) return;
    if (t.show) t.show(message, kind, undefined, action, OUTCOME_KEY);
    else if (kind === "success") t.success(message);
    else if (kind === "info") (t.info ?? t.success).call(t, message);
    else t.error(message);
  }

  /** A pass finished fine: the "new changes online" prompt is stale now. */
  private clearNewOnline(): void {
    this.deps.toast()?.dismissKey?.(NEW_ONLINE_KEY);
  }

  /**
   * "Get latest": bring in the online changes without sending anything back.
   * The lib's own pass with `push: false` (the one PDF export uses): edits not
   * in a version yet are kept (it saves a version first when it has something
   * to combine), and overlaps are combined as in any backing up.
   *
   * `fromMainDraft` is the Online tab's "Bring them in" (#524): the same pass,
   * which also combines the online Main draft into the open draft.
   */
  async handleGetLatest(fromMainDraft = false): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.gettingLatest || this.forceSyncing) return;
    this.gettingLatest = true;
    const failed = fromMainDraft
      ? "Couldn't bring in the Main draft's changes. Your work is saved on this computer — try again when you're ready."
      : "Couldn't get the latest changes. Your work is saved on this computer — try again when you're ready.";
    try {
      const outcome = await this.deps.getLatest(dir, fromMainDraft ? { bringInMainDraft: true } : undefined);
      if (this.deps.currentDir() !== dir) return;
      if (outcome.status === "synced" || outcome.status === "up-to-date") {
        this.updatesAvailable = false;
        this.clearNewOnline();
        this.recordManual(dir, outcomeState(outcome));
        if (outcome.filesChanged) {
          this.filesChanged();
          if (!this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles)) {
            this.notify("success", fromMainDraft ? "Brought in the Main draft's changes." : "Got the changes from the online copy.");
          }
        } else {
          this.notify("info", fromMainDraft ? "Nothing new from the Main draft." : "Already up to date — nothing new online.");
        }
      } else if (outcome.status === "auth") {
        this.notify("error", NOT_SIGNED_IN);
      } else if (outcome.status === "offline") {
        this.notify("info", OFFLINE);
      } else {
        if (outcome.filesChanged) this.filesChanged();
        this.notify("error", outcome.message || failed);
      }
    } catch {
      this.notify("error", failed);
    } finally {
        if (this.deps.currentDir() === dir) this.gettingLatest = false;
    }
  }

  /**
   * Surface the converge-report from a completed pass (called both from
   * handleForceSync below and from the ambient status subscription in
   * the component): one toast for marker-combined text files, one for files
   * kept as a side-by-side pair. Returns whether it showed anything, so a manual
   * pass can fold its own "done" line into this one instead of adding a second toast.
   */
  applyConvergeReport(combinedFiles?: string[], keptBothFiles?: KeptBothFile[], ambient = false): boolean {
    const t = this.deps.toast();
    // The host's own passes get their own keys, so a manual Back up or Get changes error is never replaced by them.
    const outcomeKey = ambient ? CONVERGE_AMBIENT_KEY : OUTCOME_KEY;
    let shown = false;
    if (combinedFiles && combinedFiles.length > 0) {
      const message = combinedFilesMessage(combinedFiles);
      const review = this.deps.onReviewCombined;
      // Sticky (duration 0) when it carries the way in: the author decides when they have seen it.
      // For a manual pass it replaces the pass's own outcome toast (same key), so one action
      // leaves one message; the status bar's "to decide" stays until they have.
      if (review && t?.show) t.show(message, "info", 0, { label: "Review", onClick: review }, outcomeKey);
      else if (t?.show) t.show(message, "info", undefined, undefined, outcomeKey);
      else t?.info?.(message);
      shown = true;
    }
    if (keptBothFiles && keptBothFiles.length > 0) {
      if (t?.show) t.show(keptBothMessage(keptBothFiles), "info", undefined, undefined, shown ? `${outcomeKey}-kept-both` : outcomeKey);
      else t?.info?.(keptBothMessage(keptBothFiles));
      shown = true;
    }
    return shown;
  }

  /**
   * Sync / Back up now: get the latest changes from the online copy, then back
   * up this computer's. One full pass, the same syncChanges() path the
   * auto-orchestrator uses, whatever "Back up online automatically" says.
   * Only offered when the project canSync (StatusBar's showManualSync, the
   * Online copy tab's ready state).
   */
  async handleForceSync(): Promise<void> {
    const dir = this.deps.currentDir();
    if (!dir || this.forceSyncing || this.gettingLatest) return;
    this.forceSyncing = true;
    const retry = (this.deps.autoBackup?.() ?? true)
      ? "we'll try again later."
      : "try again when you're ready.";
    const failed = `Couldn't finish sending. Your work is saved on this computer — ${retry}`;
    try {
      const outcome = await this.deps.syncChanges(dir);
      if (this.deps.currentDir() !== dir) return; // Project switched mid-sync.
      this.recordManual(dir, outcomeState(outcome));
      if (outcome.status === "synced" || outcome.status === "up-to-date") {
        this.updatesAvailable = false;
        this.clearNewOnline();
      }
      // Two takes (or a kept pair) get the one outcome toast; "backed up" folds into it.
      const converged = outcome.status === "synced" || outcome.status === "up-to-date"
        ? (outcome.combinedFiles?.length ?? 0) > 0 || (outcome.keptBothFiles?.length ?? 0) > 0
        : false;
      if (outcome.status === "synced") {
        this.completed(outcome.mergedRemoteChanges, outcome.filesChanged === true, converged);
        this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
      } else if (outcome.status === "up-to-date") {
        if (outcome.filesChanged) this.completed(false, true, converged);
        else this.notify("info", "Already up to date — nothing new to send.");
        if (converged) this.applyConvergeReport(outcome.combinedFiles, outcome.keptBothFiles);
      } else if (outcome.status === "auth") {
        if (outcome.filesChanged) this.filesChanged();
        this.notify("error", NOT_SIGNED_IN);
      } else if (outcome.status === "offline") {
        if (outcome.filesChanged) this.filesChanged();
        this.notify("info", OFFLINE);
      } else {
        if (outcome.filesChanged) this.filesChanged();
        // Error state. The lib's error-arm messages are ALL authored writer
        // copy (the MSG_* constants or an authored generic — transport.ts
        // failureOutcome; never raw git text), and some carry the actual fix
        // ("Check the book's online address"), so show them. The fixed
        // fallback covers an empty message and keeps stating what remains
        // safe (a failure must state what remains safe).
        this.notify("error", outcome.message || failed);
      }
    } catch {
      if (this.deps.currentDir() === dir) this.recordManual(dir, "error");
      this.notify("error", failed);
    } finally {
        if (this.deps.currentDir() === dir) this.forceSyncing = false;
    }
  }

  private filesChanged(): void {
    this.noteFilesWritten();
    this.deps.onFilesChanged();
  }

  private completed(merged: boolean, filesChanged: boolean, quiet: boolean): void {
    if (filesChanged) this.noteFilesWritten();
    this.deps.onSyncCompleted(merged, filesChanged, quiet);
  }

  private recordManual(dir: string, state: SyncState | "not-found", host?: string): void {
    this.lastManual = { dir, state, at: new Date().toISOString(), ...(host ? { host } : {}) };
  }

  /**
   * "Repair the online copy" (lib remote-auth/repair.ts): one fixed sequence,
   * no diagnosis. Re-entry is guarded by the Online copy tab's own "running" phase.
   */
  /** Resolves with the folder the old history was set aside in (for "Show in folder"), when the repair finished. */
  async handleRepair(): Promise<string | null> {
    const dir = this.deps.currentDir();
    if (!dir || this.forceSyncing) return null;
    const failed = "The repair didn't finish. Your work is saved on this computer — see Troubleshooting → Logs for details.";
    try {
      const { outcome, restoredFiles, movedGitTo } = await this.deps.repair(dir);
      if (this.deps.currentDir() !== dir) return null;
      const state = outcomeState(outcome);
      this.recordManual(dir, state);
      if (state !== "synced") {
        this.notify("error", outcome.message || failed);
        return null;
      }
      const n = restoredFiles.length;
      this.clearNewOnline();
      this.notify(
        "success",
        n > 0
          ? `Online copy repaired, and ${n} file${n === 1 ? "" : "s"} only the online copy had ${n === 1 ? "is" : "are"} back.`
          : "Online copy repaired. Your book is online.",
      );
      // The repair's own toast above is the one message: no second "Backed up".
      this.completed(true, n > 0 || outcome.filesChanged === true, true);
      return movedGitTo ?? null;
    } catch {
      if (this.deps.currentDir() === dir) this.recordManual(dir, "error");
      this.notify("error", failed);
      return null;
    }
  }
}
