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

import path from "node:path";

type LibModule = typeof import("@dimm-city/print-md");

/** The `versionHistory` slice of AppSettings that the snapshot policy reads.
 *  Derived from the lib's own delay-policy signature so it stays decoupled from
 *  main.ts's full AppSettings shape. */
type VersionHistorySettings = NonNullable<Parameters<LibModule["autoSnapshotDelayMs"]>[0]>;

/** External touch-points injected into the scheduler (all faked in tests). */
export interface AutoSnapshotDeps {
  /** Lazily load @dimm-city/print-md. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Read the live AppSettings (snapshot policy is re-checked on every arm/run). */
  readSettings: () => Promise<{ versionHistory: unknown }>;
  /** The currently watched/open project dir, used to guard against switches. */
  getWatchedDir: () => string | null;
  /** Resolve the operation-log file path for a repo slug (project basename). */
  operationLogPath: (slug: string) => string;
  /** Injectable timer arm. Real code uses setTimeout (+unref); tests fake it. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Injectable timer clear. Real code uses clearTimeout; tests fake it. */
  clearTimer?: (h: unknown) => void;
  /** Fires on every pending set (dir) / clear (null) so a caller can mirror it. */
  onPendingChanged?: (dir: string | null) => void;
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

export class AutoSnapshotScheduler {
  /** The single armed debounce timer + its target dir, or null when idle. */
  private pending: { dir: string; timer: unknown } | null = null;

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
      // Never AUTO-snapshot a folder that lives inside a LARGER repo (subPath
      // set): a silent automatic commit would land in — and sweep unrelated files
      // from — the ENCLOSING repository (e.g. opening a folder that happens to sit
      // inside another git repo). Explicit user snapshots and multi-book remote
      // sync still work via the version-history UI; only the AUTOMATIC commit is
      // suppressed here.
      if (source.subPath !== "") {
        console.info(`[auto-snapshot] skipped: ${dir} is a subfolder of an enclosing repo (${source.repoRoot})`);
        return;
      }
      await lib.providerFor(source).snapshot({
        projectDir: dir,
        message: lib.AUTO_SNAPSHOT_MESSAGE,
        // Record the snapshot in the project's operation log so the bottom-bar
        // "Version history" affordance shows it (local-git projects have no
        // remote/sync, but they DO snapshot — those snapshots must be logged).
        logFile: this.deps.operationLogPath(path.basename(dir)),
      });
    } catch (e) {
      const lib = await this.deps.loadLib().catch(() => null);
      if (lib?.isNoChangesError(e)) return; // clean tree — expected, not an error
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-snapshot] failed for ${dir}: ${msg}`);
      if (e instanceof Error && e.stack) console.error(e.stack);
    }
  }
}
