/**
 * auto-sync/orchestrator.ts — the automatic-sync state machine, extracted from
 * electron/main.ts as an injectable, unit-testable class.
 *
 * WHY THIS EXISTS
 * ---------------
 * The auto-sync engine used to live in main.ts as a set of free functions over
 * module globals. This class owns the same control logic, but every external
 * touch-point — the lib, the credential/token store, settings, the status
 * emit, the clock, the watched-dir guard, and the operation-log path — is
 * INJECTED via `deps`, so tests drive it with fakes.
 *
 * 2026-08-14 simplification (owner directive): sync ALWAYS converges, so the
 * conflict latch, the per-kind recovery routing, and the confirmation
 * plumbing are gone. What remains:
 *
 *   - the single-flight + runAgain + debounce/interval timers (unchanged);
 *   - outcome → ambient status mapping (conflict arm no longer exists; the
 *     converge report — combinedFiles/imageClashes — rides on the payload);
 *   - ONE repair path: a structurally damaged repo (typed preflight error or
 *     a corruption-looking throw) runs `lib.repairRepo()` behind the
 *     recovering/recovered pill states. Fully automatic, files untouched,
 *     readable history preserved (see the lib's repair.ts).
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import { operationLogSlug } from "../recovery-paths";
import { gitIdentityFrom, type GitIdentityArgs, type GitIdentitySettings } from "../git-identity";
import type {
  ImageClash,
  RepairResult,
  SyncOutcome,
  TokenStore,
} from "gutterpress";

type LibModule = typeof import("gutterpress");

/** The `versionHistory` slice of AppSettings that the auto-sync policy reads.
 *  Derived from the lib's own delay-policy signatures (the intersection of what
 *  autoSyncDelayMs and autoSnapshotDelayMs accept) so it stays decoupled from
 *  main.ts's full AppSettings shape yet satisfies both callees. */
type VersionHistorySettings = NonNullable<Parameters<LibModule["autoSyncDelayMs"]>[0]> &
  NonNullable<Parameters<LibModule["autoSnapshotDelayMs"]>[0]>;

/** The classification `lib.detectProjectSource` returns. */
type ProjectSourceResult = Awaited<ReturnType<LibModule["detectProjectSource"]>>;

/**
 * Prompt-pull delay after a project opens or a preflight repair settles —
 * seconds, NOT coupled to the (much longer) snapshot debounce. Exported so
 * main.ts's unrelated "local status" re-emit timer uses the same constant
 * instead of a second module-level copy.
 */
export const AUTO_SYNC_OPEN_DELAY_MS = 4_000;

/**
 * Per-project state for the auto-sync orchestrator. Keyed by projectDir.
 * NOT exported — external callers mutate this only through the orchestrator's
 * own methods (acquire/release/runPreflight), never by reaching into the bag.
 */
interface AutoSyncState {
  /** Debounce timer armed on file-change; fires runAutoSync when it expires. */
  debounceTimer: NodeJS.Timeout | null;
  /** Periodic safety-sync interval handle. */
  intervalHandle: NodeJS.Timeout | null;
  /** True while syncProject is awaiting a network round-trip. */
  inFlight: boolean;
  /** Coalesce burst: run exactly one sync when the current one lands. */
  runAgain: boolean;
}

/**
 * Payload emitted on the `sync:status` channel. Must match the `SyncStatus`
 * shape in contract.ts EXACTLY — ElectronAdapter.onSyncStatus forwards the raw
 * push payload to the renderer typed as SyncStatus with no transform.
 */
export interface SyncStatusPayload {
  state:
    | "idle"
    | "syncing"
    | "synced"
    | "up-to-date"
    | "offline"
    | "auth"
    | "error"
    | "recovering"
    | "recovered"
    // "local" — a local-git project with NO usable remote (none, or SSH-only).
    | "local"
    // "connect" — the repo HAS an HTTPS remote but Gutterpress holds no usable
    // credential for it.
    | "connect";
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /**
   * ISO-8601 timestamp of the last completed sync attempt (success or failure),
   * or null when none has run in this session.
   */
  lastSyncAt: string | null;
  /** Repair progress — present when state === "recovering". */
  recovery?: {
    phase: "checking" | "backup" | "repairing" | "done";
    risk: "none" | "low" | "medium" | "high";
    message?: string;
  };
  /** Plain-language outcome/repair message — present on "error" when known. */
  message?: string;
  /** On-disk backup of the old history folder — present on "recovered" when the re-clone ran. */
  backupZipPath?: string;
  /** Operation log path — present on "recovered" and "error". */
  logFile?: string;
  /** True when the completed sync/repair changed files in the local worktree. */
  filesChanged?: boolean;
  /** Files whose text now holds BOTH versions inside git conflict markers. */
  combinedFiles?: string[];
  /** Clashing images (newer kept) — drives the non-blocking picker. */
  imageClashes?: ImageClash[];
}

/** External touch-points injected into the orchestrator (all faked in tests). */
export interface AutoSyncOrchestratorDeps {
  /** Lazily load gutterpress. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store passed straight through to lib.syncProject / diagnosis. */
  tokenStore: TokenStore;
  /**
   * Read the live AppSettings. The auto-sync policy AND the author's configured
   * commit identity are re-checked on every run — `syncProject` snapshots-first
   * and can write merge commits, so those commits must carry the same identity
   * a manual "Save a version" does.
   */
  readSettings: () => Promise<{ versionHistory: VersionHistorySettings } & GitIdentitySettings>;
  /** Emit a status event to the renderer (safe when no window exists). */
  emit: (payload: SyncStatusPayload) => void;
  /** Injectable clock (epoch ms). Real code passes `Date.now`; tests fake it. */
  now: () => number;
  /** The currently watched/open project dir, used to guard against switches. */
  getWatchedDir: () => string | null;
  /** Resolve the operation-log file path for a repo slug (project basename). */
  operationLogPath: (repoSlug: string) => string;
  /**
   * Best-effort: refresh the app-open heartbeat (repair-vs-desktop detection,
   * M2 — see lib/app-heartbeat.ts) for `dir`. Called on every `run()`
   * invocation so it piggybacks on the existing periodic safety-sync tick
   * AND the file-change debounce fire — no dedicated timer is added for it.
   */
  refreshHeartbeat?: (dir: string) => void;
}

/**
 * The additional file-change sync debounce (30 s on top of the snapshot delay).
 * Short enough to feel transparent to the author but long enough that the
 * auto-snapshot timer almost always fires first so the burst is committed
 * locally before the push attempt (§4.2 ordering invariant).
 */
const AUTO_SYNC_EXTRA_DEBOUNCE_MS = 30_000;

export class AutoSyncOrchestrator {
  /** One orchestrator slot per directory (in practice 0 or 1 entries). */
  private readonly states = new Map<string, AutoSyncState>();
  /** Per-project last-sync timestamp, updated on every completed runAutoSync. */
  private readonly lastSyncAt = new Map<string, string | null>();

  constructor(private readonly deps: AutoSyncOrchestratorDeps) {}

  private nowIso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  // ── State accessors ─────────────────────────────────────────────────────────

  getOrCreateState(dir: string): AutoSyncState {
    let s = this.states.get(dir);
    if (!s) {
      s = {
        debounceTimer: null,
        intervalHandle: null,
        inFlight: false,
        runAgain: false,
      };
      this.states.set(dir, s);
    }
    return s;
  }

  getState(dir: string): AutoSyncState | undefined {
    return this.states.get(dir);
  }

  hasState(dir: string): boolean {
    return this.states.has(dir);
  }

  getLastSyncAt(dir: string): string | null {
    return this.lastSyncAt.get(dir) ?? null;
  }

  setLastSyncAt(dir: string, iso: string | null): void {
    this.lastSyncAt.set(dir, iso);
  }

  // ── External single-flight lock surface ─────────────────────────────────────

  /** Attempt to acquire the single-flight lock for `dir`. Returns false (doing
   *  nothing else) if a sync is already in flight. Never throws. */
  acquire(dir: string): boolean {
    const state = this.getOrCreateState(dir);
    if (state.inFlight) return false;
    state.inFlight = true;
    return true;
  }

  /** Release the single-flight lock for `dir`. No-op if `dir` has no tracked
   *  state (never creates one just to release it). */
  release(dir: string): void {
    const state = this.states.get(dir);
    if (state) state.inFlight = false;
  }

  // ── Timer management ────────────────────────────────────────────────────────

  /** Cancel the file-change debounce timer and periodic interval for `dir`. */
  cancelTimer(dir: string): void {
    const state = this.states.get(dir);
    if (!state) return;
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.intervalHandle) {
      clearInterval(state.intervalHandle);
      state.intervalHandle = null;
    }
  }

  /**
   * Cancel ALL auto-sync activity for ALL tracked dirs. Called on project
   * switch/close so stale timers don't fire after the watcher has moved on.
   */
  cancelAll(): void {
    for (const dir of this.states.keys()) {
      this.cancelTimer(dir);
    }
    this.states.clear();
  }

  /**
   * Start the periodic safety-sync interval for `dir` (idempotent — no-op if
   * it's already running). Pulls/pushes every `autoSyncMinutes` (default 2 min)
   * so incoming changes arrive even when the author never edits anything.
   */
  async armInterval(dir: string): Promise<void> {
    try {
      const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      if (this.deps.getWatchedDir() !== dir) return; // project switched while awaiting
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled
      const state = this.getOrCreateState(dir);
      if (!state.intervalHandle) {
        state.intervalHandle = setInterval(() => {
          void this.run(dir);
        }, periodicMs);
        if (typeof state.intervalHandle.unref === "function") state.intervalHandle.unref();
      }
    } catch (e) {
      console.warn("[auto-sync] armAutoSyncInterval failed (non-fatal):", e);
    }
  }

  /**
   * Arm/reset the file-change debounce for `dir`. The debounce is STRICTLY
   * LONGER than the snapshot debounce so auto-snapshot always commits the
   * burst BEFORE auto-sync pushes it. syncProject itself snapshots-first, so
   * even a race is safe — it just double-snapshots.
   */
  async armDebounce(dir: string): Promise<void> {
    try {
      const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      // Project may have switched while the awaits above yielded.
      if (this.deps.getWatchedDir() !== dir) return;
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled

      const state = this.getOrCreateState(dir);
      const snapshotMs = lib.autoSnapshotDelayMs(settings.versionHistory) ?? 0;
      const syncDebounceMs = snapshotMs + AUTO_SYNC_EXTRA_DEBOUNCE_MS;

      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        void this.run(dir);
      }, syncDebounceMs);
      if (typeof state.debounceTimer.unref === "function") state.debounceTimer.unref();
    } catch (e) {
      console.warn("[auto-sync] scheduleAutoSync failed (non-fatal):", e);
    }
  }

  /**
   * Public "an edit happened" trigger. Arms the file-change debounce AND ensures
   * the periodic safety interval is running (idempotent). Fire-and-forget.
   */
  schedule(dir: string): void {
    void this.armDebounce(dir);
    void this.armInterval(dir);
  }

  // ── Repair (the ONE recovery path) ─────────────────────────────────────────

  /**
   * Run `lib.repairRepo` for `dir` behind the recovering/recovered statuses,
   * map its result to an emit, and honor the follow-up policy: repaired →
   * resume promptly with a deferred sync; retry_later → re-arm after the
   * requested delay; failed → plain error status (the periodic timer keeps
   * ticking — repair is idempotent and safe to retry).
   *
   * The caller must already HOLD the single-flight slot; this releases it.
   */
  private async repairAndEmit(
    dir: string,
    lib: LibModule,
    identity: GitIdentityArgs,
    logFile: string,
    state: AutoSyncState,
  ): Promise<void> {
    this.deps.emit({
      state: "recovering",
      projectDir: dir,
      lastSyncAt: this.getLastSyncAt(dir) ?? null,
      recovery: { phase: "repairing", risk: "none" },
      logFile,
    });
    let result: RepairResult;
    try {
      result = await lib.repairRepo({
        projectDir: dir,
        tokenStore: this.deps.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
        logFile,
      });
    } catch (e) {
      console.error(`[auto-sync] repairRepo threw for ${dir}:`, e);
      result = {
        status: "failed",
        message: "The project couldn't be repaired automatically. Your files are safe.",
        actions: [],
      };
    } finally {
      state.inFlight = false;
    }
    const now = this.nowIso();
    this.setLastSyncAt(dir, now);
    if (result.status === "repaired") {
      this.deps.emit({
        state: "recovered",
        projectDir: dir,
        lastSyncAt: now,
        logFile,
        ...(result.damagedGitBackupPath
          ? { backupZipPath: result.damagedGitBackupPath }
          : {}),
        filesChanged: true,
      });
      // Resume: sync the repaired repo shortly (also honors a queued trigger).
      state.runAgain = false;
      this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
    } else if (result.status === "retry_later") {
      this.deps.emit({
        state: "error",
        projectDir: dir,
        lastSyncAt: now,
        message: result.message,
        logFile,
      });
      const retryTimer = setTimeout(() => {
        if (this.states.has(dir)) void this.run(dir);
      }, result.retryAfterMs ?? 60_000);
      if (typeof retryTimer.unref === "function") retryTimer.unref();
    } else {
      this.deps.emit({
        state: "error",
        projectDir: dir,
        lastSyncAt: now,
        message: result.message,
        logFile,
      });
    }
  }

  // ── The single-flight sync engine ───────────────────────────────────────────

  /**
   * Execute one auto-sync for `dir`. This is the ONLY place auto-sync calls the
   * network — always via `lib.syncProject`. Maps the SyncOutcome to an ambient
   * status and emits it to the renderer.
   */
  async run(dir: string): Promise<void> {
    // Any trigger reaching here is evidence the app is alive on `dir` now.
    this.deps.refreshHeartbeat?.(dir);

    const state = this.getOrCreateState(dir);

    // Single-flight guard: if already in flight, arm the runAgain flag so we
    // run exactly once more after it completes.
    if (state.inFlight) {
      state.runAgain = true;
      return;
    }

    // Claim the single-flight slot NOW, synchronously, before the first await
    // (TOCTOU guard). Every "don't sync this time" exit below must
    // releaseFlight() so the slot is never stuck true.
    state.inFlight = true;
    const releaseFlight = (): void => {
      state.inFlight = false;
      if (state.runAgain) {
        state.runAgain = false;
        void this.run(dir);
      }
    };

    // Re-check live policy every run so a settings change applies immediately.
    let lib!: LibModule;
    let repoRoot = dir;
    let identity: GitIdentityArgs = {};
    try {
      const [loadedLib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      lib = loadedLib;
      identity = gitIdentityFrom(settings);

      if (this.deps.getWatchedDir() !== dir) return releaseFlight();
      if (lib.autoSyncDelayMs(settings.versionHistory) === null) return releaseFlight();

      const source = await lib.detectProjectSource(dir);
      if (source.type !== "local-git-folder") return releaseFlight();
      repoRoot = lib.repoRootForSource(source, dir);

      // Guard: canSync = HTTPS remote + stored credential. Use the
      // credential-aware diagnosis — the same gate the renderer pill shows on.
      const diag = await lib.diagnoseProjectRemote(dir, { tokenStore: this.deps.tokenStore });
      if (!diag.canSync) return releaseFlight();
    } catch (probeErr) {
      releaseFlight();
      throw probeErr;
    }

    this.deps.emit({ state: "syncing", projectDir: dir, lastSyncAt: this.getLastSyncAt(dir) });

    const logFile = this.deps.operationLogPath(operationLogSlug(repoRoot));

    let outcome: SyncOutcome;
    try {
      outcome = await lib.syncProject({
        projectDir: dir,
        tokenStore: this.deps.tokenStore,
        logFile,
        ...identity,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-sync] syncProject threw for ${dir}: ${msg}`);
      const now = this.nowIso();
      this.setLastSyncAt(dir, now);

      // ── Out-of-memory guard ────────────────────────────────────────────────
      // A RangeError / allocation failure is a TRANSIENT resource failure, NOT
      // structural repo damage. It must NEVER trigger repair.
      if (e instanceof RangeError || /allocation failed|out of memory|heap/i.test(msg)) {
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        releaseFlight();
        return;
      }

      // ── Repair routing (the ONE recovery path) ─────────────────────────────
      // A typed preflight rejection or a corruption-looking throw runs the
      // automatic repair pipeline. Anything else is a plain transient error.
      const needsRepair =
        lib.isRepoNeedsRecoveryError(e) || lib.isLikelyRepoCorruption(e);
      if (!needsRepair) {
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        releaseFlight();
        return;
      }
      await this.repairAndEmit(dir, lib, identity, logFile, state);
      return;
    }

    state.inFlight = false;

    const completedAt = this.nowIso();
    this.setLastSyncAt(dir, completedAt);

    // Map outcome → ambient status emit. There is no conflict arm — sync
    // always converges; the converge report rides on the payload.
    switch (outcome.status) {
      case "synced":
        this.deps.emit({
          state: "synced",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
          ...(outcome.combinedFiles && outcome.combinedFiles.length > 0
            ? { combinedFiles: outcome.combinedFiles }
            : {}),
          ...(outcome.imageClashes && outcome.imageClashes.length > 0
            ? { imageClashes: outcome.imageClashes }
            : {}),
        });
        break;

      case "up-to-date":
        this.deps.emit({
          state: "up-to-date",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
        });
        break;

      case "auth":
        this.deps.emit({
          state: "auth",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
        });
        break;

      case "offline":
        this.deps.emit({
          state: "offline",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
        });
        break;

      case "error":
      default:
        this.deps.emit({
          state: "error",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.message ? { message: outcome.message } : {}),
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
        });
        break;
    }

    // Single-flight follow-up: if a trigger fired while we were in-flight, run once.
    if (state.runAgain) {
      state.runAgain = false;
      void this.run(dir);
    }
  }

  /**
   * Arm a one-shot deferred `run(dir)` after `delayMs`, firing only if `dir` is
   * STILL the watched project when the timer expires. Unref'd so it never
   * blocks app quit.
   */
  private scheduleDeferredSync(dir: string, delayMs: number): void {
    const t = setTimeout(() => {
      if (this.deps.getWatchedDir() === dir) void this.run(dir);
    }, delayMs);
    if (typeof t.unref === "function") t.unref();
  }

  // ── Preflight repair (project-open, before the first sync) ─────────────────

  /**
   * Preflight: before the initial sync, inspect `dir`'s repo for structural
   * damage. If any is found, run `lib.repairRepo()` BEFORE the first `run()`
   * so the author sees a transparent repair on open rather than a sync error.
   * No-op for non-git projects (a deferred sync is scheduled immediately).
   *
   * CONCURRENCY: holds the single-flight lock for the duration of the repair
   * so `run()` cannot call `lib.syncProject` concurrently on the same repo.
   * Never throws — a failure here can't wedge the project; a deferred sync is
   * always scheduled as the fallback.
   */
  async runPreflight(dir: string, source: ProjectSourceResult): Promise<void> {
    if (!this.acquire(dir)) return;
    const state = this.getOrCreateState(dir);

    try {
      const lib = await this.deps.loadLib();

      if (source.type !== "local-git-folder") {
        this.release(dir);
        this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      const health = await lib.inspectRepo({ repoDir: dir });
      if (lib.classifyFromHealth(health) === null) {
        // Healthy repo — release lock and schedule the normal initial sync.
        this.release(dir);
        this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      console.log(`[preflight] structural damage detected for ${dir}; repairing before first sync`);
      const logFile = this.deps.operationLogPath(
        operationLogSlug(lib.repoRootForSource(source, dir)),
      );
      const identity = gitIdentityFrom(await this.deps.readSettings());
      // Log the full diagnosis before repairing, so support sees WHY.
      lib
        .resolveLogger(logFile, "preflight")
        .info(
          "detect",
          "structural damage detected on open",
          lib.buildPreflightDiagnostics(dir, dir, health, lib.classifyFromHealth(health)),
        );
      // repairAndEmit releases the single-flight slot and schedules the
      // deferred resume itself.
      await this.repairAndEmit(dir, lib, identity, logFile, state);
    } catch (err) {
      // Preflight is non-blocking: always release the lock so the project is
      // not permanently wedged. Then let the normal initial sync proceed.
      this.release(dir);
      console.warn("[preflight] repair failed (non-fatal):", err);
      this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
    }
  }
}
