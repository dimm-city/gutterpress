/**
 * auto-snapshot/scheduler.ts — the debounced host-side auto-snapshot state
 * machine, extracted from electron/main.ts as an injectable, unit-testable class.
 *
 * WHY THIS EXISTS
 * ---------------
 * The auto-snapshot engine used to live in main.ts as a set of free functions
 * over module globals (`autoSnapshotPending`, `scheduleAutoSnapshot`,
 * `runAutoSnapshot`, `flushAutoSnapshot`, `cancelAutoSnapshotTimer`). That made
 * the single-pending-timer / live-policy-reread / stale-dir-guard invariants
 * impossible to unit-test without a full Electron + lib stack. This class owns
 * the exact same control logic, but every external touch-point — the lib,
 * settings, the watched-dir guard, the operation-log path, and the clock — is
 * INJECTED via `deps`, so tests drive it with fakes.
 *
 * The behavior is a faithful move of the original main.ts code: the guards, the
 * snapshot payload, the log-path derivation, the error swallowing, and the timer
 * semantics are preserved verbatim. Mirroring AutoSyncOrchestrator, the class
 * owns the single pending timer + policy; main.ts keeps thin delegators and a
 * module-level mirror of `pending` (updated only via `onPendingChanged`) so the
 * off-limits createWindow read stays byte-identical.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import { gitIdentityFrom, type GitIdentitySettings } from "../git-identity";
import { operationLogSlug } from "../recovery-paths";

type LibModule = typeof import("gutterpress");

/** The `versionHistory` slice of AppSettings that the snapshot policy reads.
 *  Derived from the lib's own delay-policy signature so it stays decoupled from
 *  main.ts's full AppSettings shape. */
type VersionHistorySettings = NonNullable<Parameters<LibModule["autoSnapshotDelayMs"]>[0]>;

/** External touch-points injected into the scheduler (all faked in tests). */
export interface AutoSnapshotDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /**
   * Read the live AppSettings. Both the snapshot policy AND the author's
   * configured commit identity are re-read on every arm/run, so a settings
   * change applies to the very next automatic snapshot.
   */
  readSettings: () => Promise<{ versionHistory: unknown } & GitIdentitySettings>;
  /** The currently watched/open project dir, used to guard against switches. */
  getWatchedDir: () => string | null;
  /** Resolve the operation-log file path for a repo slug (see recovery-paths.ts's operationLogSlug). */
  operationLogPath: (slug: string) => string;
  /** Injectable timer arm. Real code uses setTimeout (+unref); tests fake it. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Injectable timer clear. Real code uses clearTimeout; tests fake it. */
  clearTimer?: (h: unknown) => void;
  /** Fires on every pending set (dir) / clear (null) so a caller can mirror it. */
  onPendingChanged?: (dir: string | null) => void;
  /**
   * Fires once `run()`'s catch has failed {@link AUTO_SNAPSHOT_FAILURE_THRESHOLD}
   * times in a row for `dir`, and again on every subsequent multiple of the
   * threshold (M39). `consecutiveFailures` is always an exact multiple of the
   * threshold when this fires. A success or a clean-tree run resets the streak
   * (and this stops firing) without calling back. Optional — a caller that
   * doesn't supply it just keeps the pre-existing console.error-only behavior.
   */
  onSnapshotFailed?: (dir: string, consecutiveFailures: number, error: unknown) => void;
}

/** Default timer arm: setTimeout that never keeps the app alive for a pending snapshot. */
function defaultSetTimer(cb: () => void, ms: number): unknown {
  const timer = setTimeout(cb, ms);
  if (typeof (timer as NodeJS.Timeout).unref === "function") (timer as NodeJS.Timeout).unref();
  return timer;
}

function defaultClearTimer(h: unknown): void {
  clearTimeout(h as NodeJS.Timeout);
}

/**
 * Consecutive `run()` failures (for the SAME dir) before `onSnapshotFailed`
 * fires (M39 — UX critical review: the catch used to only `console.error` and
 * return, so a persistently broken safety net — stale lock, permissions —
 * gave zero signal while the pill kept asserting "Version history on"). Fires
 * again on every subsequent multiple of the threshold so a long-running
 * failure keeps re-signalling rather than going silent forever.
 */
export const AUTO_SNAPSHOT_FAILURE_THRESHOLD = 3;

export class AutoSnapshotScheduler {
  /** The single armed debounce timer + its target dir, or null when idle. */
  private pending: { dir: string; timer: unknown } | null = null;

  /** Consecutive `run()` failures for the most recent dir. Reset by a success
   *  or a clean-tree ("no changes") outcome. Not per-dir: only one project is
   *  ever watched at a time, matching the rest of this class's single-dir model. */
  private consecutiveFailures = 0;

  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly deps: AutoSnapshotDeps) {
    this.setTimer = deps.setTimer ?? defaultSetTimer;
    this.clearTimer = deps.clearTimer ?? defaultClearTimer;
  }

  private notifyPending(dir: string | null): void {
    this.deps.onPendingChanged?.(dir);
  }

  hasPending(): boolean {
    return this.pending !== null;
  }

  /** Cancel the armed debounce timer (project close / staged-update flush points). */
  cancel(): void {
    if (this.pending) {
      this.clearTimer(this.pending.timer);
      this.pending = null;
      this.notifyPending(null);
    }
  }

  /**
   * Fire the pending auto-snapshot NOW (project close / app quit flush points).
   * Returns the in-flight snapshot promise, or `undefined` when nothing pends.
   */
  flush(): Promise<void> | undefined {
    if (!this.pending) return undefined;
    const dir = this.pending.dir;
    this.cancel();
    return this.run(dir);
  }

  /** Arm/reset the debounce timer after an edit signal in `dir`. */
  schedule(dir: string): void {
    void (async () => {
      try {
        // Read settings + lib policy on every arm so changes apply live.
        const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
        // Project may have switched while the awaits above yielded — arming a
        // timer for the OLD directory would fire a stray snapshot there.
        if (this.deps.getWatchedDir() !== dir) return;
        const delayMs = lib.autoSnapshotDelayMs(settings.versionHistory as VersionHistorySettings);
        this.cancel();
        if (delayMs === null) return; // automatic snapshots disabled
        const timer = this.setTimer(() => {
          this.pending = null;
          this.notifyPending(null);
          void this.run(dir);
        }, delayMs);
        this.pending = { dir, timer };
        this.notifyPending(dir);
      } catch (e) {
        console.warn("[auto-snapshot] scheduling failed (non-fatal):", e);
      }
    })();
  }

  async run(dir: string): Promise<void> {
    try {
      const lib = await this.deps.loadLib();
      // Re-check the live policy: the user may have toggled auto-snapshots off
      // while this timer was already armed.
      const settings = await this.deps.readSettings();
      if (lib.autoSnapshotDelayMs(settings.versionHistory as VersionHistorySettings) === null) return;
      const source = await lib.detectProjectSource(dir);
      if (source.type !== "local-git-folder") return;
      await lib.providerFor(source).snapshot({
        projectDir: dir,
        message: lib.AUTO_SNAPSHOT_MESSAGE,
        // Record the snapshot in the project's operation log so the bottom-bar
        // "Version history" affordance shows it (local-git projects have no
        // remote/sync, but they DO snapshot — those snapshots must be logged).
        // Keyed to the REPO, not the opened book: the snapshot commits the whole
        // repository, so a monorepo's books share one log instead of one file
        // each (see recovery-paths.ts's operationLogSlug).
        logFile: this.deps.operationLogPath(operationLogSlug(lib.repoRootForSource(source, dir))),
        // Attribute the commit to the author, exactly like the manual
        // "Save a version" route does. Without this, automatic snapshots — the
        // overwhelming majority of a project's history — were committed as the
        // lib's "Gutterpress" default while manual saves carried the real name.
        ...gitIdentityFrom(settings),
      });
      // Success — the safety net is working again; clear any failure streak.
      this.consecutiveFailures = 0;
    } catch (e) {
      const lib = await this.deps.loadLib().catch(() => null);
      if (lib?.isNoChangesError(e)) {
        // Clean tree — expected, not a failure of the safety net itself.
        this.consecutiveFailures = 0;
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-snapshot] failed for ${dir}: ${msg}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures % AUTO_SNAPSHOT_FAILURE_THRESHOLD === 0) {
        this.deps.onSnapshotFailed?.(dir, this.consecutiveFailures, e);
      }
    }
  }
}
