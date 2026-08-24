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
 *   - the single-flight + runAgain guards and the periodic safety interval;
 *   - the PUSH CADENCE gate (owner decision 2026-08-23): every tick calls
 *     `lib.syncProject`, but only a tick whose push window
 *     (AUTO_SYNC_PUSH_INTERVAL_MINUTES) has elapsed passes `push: true` —
 *     the rest run pull-merge-only passes, so remote work keeps arriving
 *     every ~2 minutes while local work uploads in quiet ~15-minute batches
 *     plus one final bounded pass on project close/app exit (runExitPush);
 *   - outcome → ambient status mapping (conflict arm no longer exists; the
 *     converge report — combinedFiles/keptBothFiles — rides on the payload);
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import { operationLogSlug } from "../recovery-paths";
import { gitIdentityFrom, type GitIdentityArgs, type GitIdentitySettings } from "../git-identity";
import type { KeptBothFile, SyncOutcome, TokenStore } from "gutterpress";

type LibModule = typeof import("gutterpress");

/** The `versionHistory` slice of AppSettings that the auto-sync policy reads.
 *  Derived from the lib's own delay-policy signature so it stays decoupled
 *  from main.ts's full AppSettings shape yet satisfies the callee. */
type VersionHistorySettings = NonNullable<Parameters<LibModule["autoSyncDelayMs"]>[0]>;

/** The classification `lib.detectProjectSource` returns. */
/**
 * Prompt-pull delay after a project opens — seconds, NOT coupled to the
 * (much longer) snapshot debounce. Exported so main.ts's unrelated "local
 * status" re-emit timer uses the same constant instead of a second
 * module-level copy.
 */
export const AUTO_SYNC_OPEN_DELAY_MS = 4_000;

/**
 * Budget for the final exit push (project close / app quit). An app that
 * hangs on quit because the network dropped is worse than an unpushed change:
 * past this, quit proceeds — the underlying sync keeps running if the process
 * stays alive (project switch), and a killed push is harmless server-side
 * (receive-pack applies the ref update only on a complete pack). Whatever the
 * pass could not send, the next launch's first tick pushes.
 */
export const EXIT_PUSH_BUDGET_MS = 8_000;

/**
 * Per-project state for the auto-sync orchestrator. Keyed by projectDir.
 * NOT exported — external callers mutate this only through the orchestrator's
 * own methods (acquire/release/scheduleInitialSync), never by reaching into the bag.
 */
interface AutoSyncState {
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
    // "synced" — the sync completed. It covers BOTH lib outcomes: work was
    // sent, or there was nothing to send. The renderer draws them
    // identically ("Everything is in sync"), so there is no second state.
    | "synced"
    | "offline"
    | "auth"
    | "error"
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
  /** Plain-language outcome message — present on "error" when known. */
  message?: string;
  /** Operation log path — present on "error". */
  logFile?: string;
  /** True when the completed sync changed files in the local worktree. */
  filesChanged?: boolean;
  /** Files whose text now holds BOTH versions inside git conflict markers. */
  combinedFiles?: string[];
  /** Files kept as a pair: ours at `path`, the online one at `onlinePath`. */
  keptBothFiles?: KeptBothFile[];
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
}

export class AutoSyncOrchestrator {
  /** One orchestrator slot per directory (in practice 0 or 1 entries). */
  private readonly states = new Map<string, AutoSyncState>();
  /** Per-project last-sync timestamp, updated on every completed runAutoSync. */
  private readonly lastSyncAt = new Map<string, string | null>();
  /**
   * Per-project epoch-ms of the last COMPLETED push-enabled pass ("synced" or
   * "up-to-date" — either way local and remote agreed when it finished). No
   * entry = a push is due: the session's first tick pushes, which is what
   * delivers work an earlier session's exit pass could not send. Failed or
   * timed-out passes never set it, so the next 2-minute tick retries the push.
   */
  private readonly lastPushAt = new Map<string, number>();

  constructor(private readonly deps: AutoSyncOrchestratorDeps) {}

  /** True when this tick should also push: no completed push-enabled pass yet,
   *  or the push window has elapsed since the last one. */
  private isPushDue(dir: string, lib: LibModule): boolean {
    const last = this.lastPushAt.get(dir);
    if (last === undefined) return true;
    return this.deps.now() - last >= lib.AUTO_SYNC_PUSH_INTERVAL_MINUTES * 60_000;
  }

  private nowIso(): string {
    return new Date(this.deps.now()).toISOString();
  }

  // ── State accessors ─────────────────────────────────────────────────────────

  getOrCreateState(dir: string): AutoSyncState {
    let s = this.states.get(dir);
    if (!s) {
      s = {
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

  /** Cancel the periodic safety-sync interval for `dir`. */
  cancelTimer(dir: string): void {
    const state = this.states.get(dir);
    if (!state) return;
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
   * Public "an edit happened" trigger: ensure the periodic safety interval is
   * running (idempotent). Fire-and-forget.
   *
   * There is deliberately NO file-change debounce. The one that used to live
   * here waited `autoSnapshotDelayMs + 30 s` — 10 min + 30 s = 10.5 min at
   * defaults — while this interval already ticks every `autoSyncMinutes`
   * (2 min at defaults) for as long as the project is open. Five interval
   * ticks fit inside one debounce window, so it could never cause a sync the
   * interval had not already caused. Raising `autoSyncMinutes` past 10.5 min
   * is the only way it would fire first, and that is a writer explicitly
   * asking to sync LESS often.
   */
  schedule(dir: string): void {
    void this.armInterval(dir);
  }

  // ── The single-flight sync engine ───────────────────────────────────────────

  /**
   * Execute one auto-sync for `dir`. This is the ONLY place auto-sync calls the
   * network — always via `lib.syncProject`. Maps the SyncOutcome to an ambient
   * status and emits it to the renderer.
   */
  async run(dir: string): Promise<void> {
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

      // Gate: local git folder + HTTPS remote + stored credential.
      const gate = await this.syncGate(lib, dir);
      if (!gate) return releaseFlight();
      repoRoot = gate.repoRoot;
    } catch (probeErr) {
      releaseFlight();
      throw probeErr;
    }

    this.deps.emit({ state: "syncing", projectDir: dir, lastSyncAt: this.getLastSyncAt(dir) });

    const logFile = this.deps.operationLogPath(operationLogSlug(repoRoot));

    // Push-cadence gate: every tick pulls (remote work keeps arriving
    // promptly); only a tick whose push window has elapsed also pushes.
    const pushDue = this.isPushDue(dir, lib);

    let outcome: SyncOutcome;
    try {
      outcome = await lib.syncProject({
        projectDir: dir,
        tokenStore: this.deps.tokenStore,
        logFile,
        ...identity,
        push: pushDue,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-sync] syncProject threw for ${dir}: ${msg}`);
      const now = this.nowIso();
      this.setLastSyncAt(dir, now);

      // Every throw is the same story for the writer: this sync didn't happen
      // and the work is still safely on disk. syncProject reports expected
      // failures through its outcome, so anything thrown here is unexpected —
      // a damaged history included. The status pill says so plainly and the
      // periodic timer keeps trying.
      this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
      releaseFlight();
      return;
    }

    state.inFlight = false;

    const completedAt = this.nowIso();
    this.setLastSyncAt(dir, completedAt);
    // A COMPLETED push-enabled pass resets the push window: "synced" pushed,
    // "up-to-date" verified there was nothing to push. Failures leave the
    // window armed so the next tick retries the push.
    if (pushDue && (outcome.status === "synced" || outcome.status === "up-to-date")) {
      this.lastPushAt.set(dir, this.deps.now());
    }

    // Map outcome → ambient status emit. There is no conflict arm — sync
    // always converges; the converge report rides on the payload.
    switch (outcome.status) {
      // Both report "in sync" to the writer. A pull-merge-only pass lands on
      // `up-to-date` and CAN still have combined files (both sides moved, the
      // push was held), so the converge report is forwarded from either —
      // keeping them one arm is what stops the next field being added to only
      // one of them.
      case "synced":
      case "up-to-date":
        this.deps.emit({
          state: "synced",
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
          ...(outcome.combinedFiles && outcome.combinedFiles.length > 0
            ? { combinedFiles: outcome.combinedFiles }
            : {}),
          ...(outcome.keptBothFiles && outcome.keptBothFiles.length > 0
            ? { keptBothFiles: outcome.keptBothFiles }
            : {}),
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
   * The exit pass (owner decision 2026-08-23): one final PUSH-ENABLED sync at
   * the host's existing project-close/app-quit flush point, so work held back
   * by pull-only ticks goes online before the app goes away. Not `run()`:
   * that method is guarded on `dir` still being the watched project, and by
   * exit time the watcher has moved on (or is about to).
   *
   * - Respects the single-flight SYNCHRONOUSLY (main.ts calls this right
   *   before `cancelAll()` wipes the state bag): an in-flight tick and the
   *   exit pass never overlap — skip rather than wait, the next launch's
   *   first tick pushes whatever was pending.
   * - BOUNDED by `budgetMs`: past it, quit proceeds. The abandoned sync keeps
   *   running only if the process stays alive (project switch), where the
   *   lib's per-repo FIFO lock serializes it against anything that follows.
   * - No status emits: the pill has moved on with the project (or the window
   *   is gone); the operation log still records the pass.
   */
  /**
   * "Can this project sync right now?" — the gate `run()` and `runExitPush()
   * must agree on. Kept in one place because the exit pass is the copy that
   * runs unwatched: a new source type or credential rule added to only one of
   * them would diverge silently.
   *
   * Passes the already-detected `source` to `diagnoseProjectRemote`, which
   * would otherwise re-run `detectProjectSource` itself.
   */
  private async syncGate(
    lib: LibModule,
    dir: string,
  ): Promise<{ repoRoot: string } | null> {
    const source = await lib.detectProjectSource(dir);
    if (source.type !== "local-git-folder") return null;
    const diag = await lib.diagnoseProjectRemote(dir, {
      source,
      tokenStore: this.deps.tokenStore,
    });
    if (!diag.canSync) return null;
    return { repoRoot: lib.repoRootForSource(source, dir) };
  }

  async runExitPush(dir: string, budgetMs: number = EXIT_PUSH_BUDGET_MS): Promise<void> {
    if (!this.acquire(dir)) return;
    try {
      const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      if (lib.autoSyncDelayMs(settings.versionHistory) === null) return;
      const gate = await this.syncGate(lib, dir);
      if (!gate) return;

      const logFile = this.deps.operationLogPath(operationLogSlug(gate.repoRoot));
      const sync = lib.syncProject({
        projectDir: dir,
        tokenStore: this.deps.tokenStore,
        logFile,
        ...gitIdentityFrom(settings),
        push: true,
      });
      // A rejection after the budget has expired must not become an unhandled
      // rejection; before it expires, the race below surfaces it to the catch.
      sync.catch(() => {});
      const outcome = await Promise.race([
        sync,
        new Promise<null>((resolve) => {
          const t = setTimeout(() => resolve(null), budgetMs);
          if (typeof t.unref === "function") t.unref();
        }),
      ]);
      if (outcome && (outcome.status === "synced" || outcome.status === "up-to-date")) {
        this.lastPushAt.set(dir, this.deps.now());
      } else {
        // Timed out or failed: whatever is unpushed stays safely local — and
        // clearing the window makes the next open's FIRST tick push it,
        // instead of waiting out the remainder of a 15-minute window.
        this.lastPushAt.delete(dir);
      }
    } catch {
      // syncProject reports expected failures via its outcome; a throw here is
      // unexpected (a damaged history, a probe failure). Either way: quit must
      // not hang on it.
      this.lastPushAt.delete(dir);
    } finally {
      this.release(dir);
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

  // ── Project open ────────────────────────────────────────────────────────────

  /**
   * Schedule the initial sync shortly after a project opens. Every project
   * type takes the same path — a damaged repo is not inspected here; if its
   * history is unreadable the sync itself reports that plainly.
   */
  scheduleInitialSync(dir: string): void {
    this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
  }
}
