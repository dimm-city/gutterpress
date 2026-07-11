/**
 * auto-sync/orchestrator.ts — the automatic-sync state machine, extracted from
 * electron/main.ts as an injectable, unit-testable class.
 *
 * WHY THIS EXISTS
 * ---------------
 * The auto-sync engine used to live in main.ts as a set of free functions over
 * module globals (`autoSyncStates`, `autoSyncLastAt`, `watchedDir`,
 * `runAutoSync`, `scheduleAutoSync`, `armAutoSyncInterval`, …). That made the
 * single-flight / runAgain / conflict-latch invariants impossible to unit-test
 * without a full Electron + lib + network stack. This class owns the exact same
 * control logic, but every external touch-point — the lib, the credential/token
 * store, settings, the status emit, the clock, the watched-dir guard, the
 * operation-log path, and the recovery-context builder — is INJECTED via `deps`,
 * so tests drive it with fakes.
 *
 * The behavior is a faithful move of the original main.ts code: the guards, the
 * emit payloads, the recovery routing, and the timer semantics are preserved
 * verbatim. See main.ts history and the transparent-sync plan (§4.1/§4.2/§5.3)
 * for the design rationale that governs each branch.
 *
 * Node/lib-side ONLY — never imported by the renderer.
 */

import path from "node:path";
import {
  decideRunAgainAfterPreflight as decideRunAgainAfterPreflightImpl,
  isConflictFileBinary,
  type RecoveryResultStatus,
  type RunAgainDecision,
} from "../recovery-bridge";
import { mapRecoveryResultToEmit } from "./recovery-emit";
import type {
  ConflictFile as ConflictFileInfo,
  RecoveryContext,
  RepoHealth,
  SyncErrorKind,
  SyncOutcome,
  TokenStore,
} from "@dimm-city/print-md";

type LibModule = typeof import("@dimm-city/print-md");

/** The `versionHistory` slice of AppSettings that the auto-sync policy reads.
 *  Derived from the lib's own delay-policy signatures (the intersection of what
 *  autoSyncDelayMs and autoSnapshotDelayMs accept) so it stays decoupled from
 *  main.ts's full AppSettings shape yet satisfies both callees. */
type VersionHistorySettings = NonNullable<Parameters<LibModule["autoSyncDelayMs"]>[0]> &
  NonNullable<Parameters<LibModule["autoSnapshotDelayMs"]>[0]>;

/** The classification `lib.detectProjectSource` returns. Derived from the lib's
 *  own signature (like VersionHistorySettings above) so runPreflight/callers
 *  stay decoupled from a named `ProjectSource` import. */
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
 * NOT exported — external callers (main.ts, ExportController) mutate this
 * only through the orchestrator's own methods (acquire/release/latchConflict/
 * unlatch/runPreflight), never by reaching into the bag directly. See finding
 * #7 (2026-07-10 architecture review): the mutable bag used to be the only
 * mutation surface, which let three call sites hand-roll the single-flight /
 * conflict-latch invariants this class exists to own.
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
  /** Conflict-latch: auto-sync is paused until re-enabled for this dir. */
  conflictLatched: boolean;
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
    | "conflict"
    | "error"
    | "recovering"
    | "recovered"
    // "local" — a local-git project with no syncable remote. There is no sync,
    // but version history (auto-snapshots) is active; the pill surfaces a
    // clickable "Version history on" label that opens the operation log.
    | "local";
  /** Absolute path of the project this status applies to. */
  projectDir: string;
  /**
   * Present (non-empty) only when state === "conflict". Each entry carries the
   * host-authoritative `isBinary` flag (L12 — see `isConflictFileBinary` in
   * `../recovery-bridge`) so `ConflictChoicesDialog` never has to re-derive it
   * from the file extension itself.
   */
  files?: Array<ConflictFileInfo & { isBinary: boolean }>;
  /**
   * Local/remote snapshot ids backing the conflict resolution (M13). Present
   * only when this emit site can compute them — see the matching doc comment
   * on `SyncStatus` in `src/lib/platform/contract.ts` (this type must match it
   * EXACTLY).
   */
  localId?: string;
  remoteId?: string;
  /**
   * ISO-8601 timestamp of the last completed sync attempt (success or failure),
   * or null when none has run in this session.
   */
  lastSyncAt: string | null;
  /**
   * Recovery progress — present when state === "recovering".
   * Both `phase` and `risk` are required to match RecoveryProgressInfo in contract.ts.
   */
  recovery?: {
    phase: "checking" | "backup" | "repairing" | "done";
    risk: "none" | "low" | "medium" | "high";
    message?: string;
  };
  /** Manual guidance — present when state === "error" and failure was classified. */
  guidance?: object;
  /** Backup zip path — present on "recovered" and classified "error". */
  backupZipPath?: string;
  /** Operation log path — present on "recovered", "error", and "conflict". */
  logFile?: string;
  /** True when the completed sync/recovery changed files in the local worktree. */
  filesChanged?: boolean;
}

/** External touch-points injected into the orchestrator (all faked in tests). */
export interface AutoSyncOrchestratorDeps {
  /** Lazily load @dimm-city/print-md. Cached by the caller. */
  loadLib: () => Promise<LibModule>;
  /** Credential store passed straight through to lib.syncProject / diagnosis. */
  tokenStore: TokenStore;
  /** Read the live AppSettings (auto-sync policy is re-checked on every run). */
  readSettings: () => Promise<{ versionHistory: VersionHistorySettings }>;
  /** Emit a status event to the renderer (safe when no window exists). */
  emit: (payload: SyncStatusPayload) => void;
  /** Injectable clock (epoch ms). Real code passes `Date.now`; tests fake it. */
  now: () => number;
  /** The currently watched/open project dir, used to guard against switches. */
  getWatchedDir: () => string | null;
  /** Resolve the operation-log file path for a repo slug (project basename). */
  operationLogPath: (repoSlug: string) => string;
  /** Build a RecoveryContext (wraps lib.buildRecoveryContext + the host gate). */
  buildRecoveryContext: (
    projectDir: string,
    lib: LibModule,
    tokenStore: TokenStore,
    authorName?: string,
    logFile?: string,
  ) => Promise<RecoveryContext>;
  /**
   * Best-effort: refresh the app-open heartbeat (repair-vs-viewer detection,
   * M2 — see lib/app-heartbeat.ts) for `dir`. Called on every `run()`
   * invocation so it piggybacks on the existing periodic safety-sync tick
   * AND the file-change debounce fire — no dedicated timer is added for it.
   * Optional so existing callers/tests are unaffected.
   *
   * KNOWN LIMITATION: `run()` is only reachable via `armInterval`/`armDebounce`,
   * both of which no-op when `autoSyncDelayMs` is `null` (auto-sync master
   * switch off). With auto-sync off, the heartbeat is written once at project
   * open (see main.ts) and never refreshed again, so it goes stale after its
   * TTL even though the project may still be open. Accepted per the M2 spec
   * (detection, not a cross-process lock manager; "do NOT add a new timer" —
   * there is no other existing tick to piggyback on for this case) — `repair
   * --force` remains the escape hatch.
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
  /** One orchestrator slot per directory. We only ever have one open project, so
   *  in practice this is a map of 0 or 1 entries — but the keyed shape makes
   *  future multi-project support trivial and keeps close/switch logic explicit. */
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
        conflictLatched: false,
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

  /** True when `dir` currently has an unresolved conflict latch (auto-sync
   *  paused pending user resolution). Read-only — the sanctioned replacement
   *  for callers that used to read `getState(dir)?.conflictLatched` directly. */
  isConflictLatched(dir: string): boolean {
    return this.states.get(dir)?.conflictLatched ?? false;
  }

  // ── External single-flight lock surface ─────────────────────────────────────
  // `run()` manages its OWN single-flight guard internally (see below) — these
  // two methods exist so a caller OUTSIDE run() (runPreflight, below) can hold
  // the exact same lock across a multi-step async flow without reaching into
  // the state bag. Finding #7 (2026-07-10 architecture review): main.ts used to
  // hand-roll `syncState.inFlight = true/false` at five separate sites to do
  // exactly this.

  /** Attempt to acquire the single-flight lock for `dir`. Returns false (doing
   *  nothing else) if a sync is already in flight — the caller decides what
   *  "already busy" means for it (run() marks runAgain; runPreflight just
   *  skips). Never throws. */
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

  // ── Conflict-latch surface ──────────────────────────────────────────────────

  /**
   * Latch `dir`'s conflict flag: cancels its timers, stamps `lastSyncAt`, and
   * emits the `conflict` status to the renderer. The ONE mutation surface for a
   * conflict detected OUTSIDE `run()` (currently: the pre-export sync safety
   * gate in ExportController). `run()`'s own conflict/error branches stay
   * inline — they have follow-up bookkeeping (runAgain, `em.status` reuse) that
   * is specific to the outcome shape already in hand there.
   *
   * `localId`/`remoteId` are optional (M13): the pre-export gate's caller
   * (`export/controller.ts`) does not currently thread them through this
   * method, so the ambient pill falls back to the ids-fetch path for that one
   * emit site (`sync-controller.svelte.ts`'s `conflictPending` state) — this
   * signature accepts them so a future caller CAN pass them without a
   * breaking change.
   */
  latchConflict(dir: string, files: ConflictFileInfo[], localId?: string, remoteId?: string): void {
    const state = this.getOrCreateState(dir);
    state.conflictLatched = true;
    state.runAgain = false;
    this.cancelTimer(dir);
    const at = this.nowIso();
    this.setLastSyncAt(dir, at);
    this.deps.emit({
      state: "conflict",
      files: files.map((f) => ({ ...f, isBinary: isConflictFileBinary(f.path) })),
      projectDir: dir,
      lastSyncAt: at,
      ...(localId ? { localId } : {}),
      ...(remoteId ? { remoteId } : {}),
    });
  }

  /**
   * Clear `dir`'s conflict latch (does NOT resume timers — call `schedule()`/
   * `armInterval()` afterward if the caller wants sync to resume immediately).
   * No-op if `dir` has no tracked state.
   */
  unlatch(dir: string): void {
    const state = this.states.get(dir);
    if (state) state.conflictLatched = false;
  }

  // ── Timer management ────────────────────────────────────────────────────────

  /**
   * Cancel the file-change debounce timer and periodic interval for `dir`.
   * Does NOT reset the conflict-latch; that requires an explicit user action.
   */
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
   * Start the periodic safety-sync interval for `dir` (idempotent — no-op if it's
   * already running). Pulls/pushes every `autoSyncMinutes` (default 2 min) so
   * incoming changes arrive even when the author never edits anything. Must be
   * armed on project OPEN, not only on the first file change — otherwise a
   * view-only session never pulls. Respects the master switch + conflict latch.
   *
   * Async so callers can `await` it in tests; production call sites fire-and-forget.
   */
  async armInterval(dir: string): Promise<void> {
    try {
      const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      if (this.deps.getWatchedDir() !== dir) return; // project switched while awaiting
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled
      const state = this.getOrCreateState(dir);
      if (state.conflictLatched) return; // paused until user resolves
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
   * Arm/reset the file-change debounce for `dir`. The debounce is STRICTLY LONGER
   * than the snapshot debounce (which defaults to 10 min) so auto-snapshot always
   * commits the burst BEFORE auto-sync pushes it. In addition, syncProject itself
   * snapshots-first, so even a race is safe — it just double-snapshots.
   *
   * Async so tests can `await` it; production call sites fire-and-forget via schedule().
   */
  async armDebounce(dir: string): Promise<void> {
    try {
      const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);
      // Project may have switched while the awaits above yielded.
      if (this.deps.getWatchedDir() !== dir) return;
      const periodicMs = lib.autoSyncDelayMs(settings.versionHistory);
      if (periodicMs === null) return; // auto-sync disabled

      const state = this.getOrCreateState(dir);
      if (state.conflictLatched) return; // paused until user resolves

      // Arm the file-change debounce: snapshot debounce + extra gap (so the
      // local snapshot commits the burst before this push). The periodic
      // interval below is what guarantees PULLS happen promptly regardless.
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
   * the periodic safety interval is running (idempotent). Fire-and-forget — the
   * two async arms run without awaiting, matching the original scheduleAutoSync.
   */
  schedule(dir: string): void {
    void this.armDebounce(dir);
    // Ensure the periodic safety interval is running (idempotent).
    void this.armInterval(dir);
  }

  // ── Run-again-after-preflight decision (delegates to the pure rule) ──────────

  decideRunAgainAfterPreflight(status: RecoveryResultStatus, runAgain: boolean): RunAgainDecision {
    return decideRunAgainAfterPreflightImpl(status, runAgain);
  }

  // ── The single-flight sync engine ───────────────────────────────────────────

  /**
   * Execute one auto-sync for `dir`. This is the ONLY place auto-sync calls the
   * network — always via `lib.syncProject`, never via statusMatrix or any walk.
   * Maps the SyncOutcome to an ambient status and emits it to the renderer.
   */
  async run(dir: string): Promise<void> {
    // Any trigger reaching here — periodic tick, edit debounce, resume, prompt
    // pull — is evidence the app is alive and working on `dir` right now.
    this.deps.refreshHeartbeat?.(dir);

    const state = this.getOrCreateState(dir);

    // Single-flight guard: if already in flight, arm the runAgain flag so we run
    // exactly once more after it completes. Never queue more than one follow-up.
    if (state.inFlight) {
      state.runAgain = true;
      return;
    }

    // Conflict-latch: if a conflict is pending, do NOT sync again until the user
    // resolves it. Auto-snapshot keeps running; we just skip network work.
    if (state.conflictLatched) return;

    // Re-check live policy every run so a settings change applies immediately.
    const [lib, settings] = await Promise.all([this.deps.loadLib(), this.deps.readSettings()]);

    // Guard: watched dir may have changed while we awaited the above.
    if (this.deps.getWatchedDir() !== dir) return;

    // Guard: auto-sync policy (master switch).
    if (lib.autoSyncDelayMs(settings.versionHistory) === null) return;

    // Guard: only local-git-folder projects sync.
    const source = await lib.detectProjectSource(dir);
    if (source.type !== "local-git-folder") return;

    // Guard: canSync = HTTPS remote + stored credential. Local-only projects never
    // auto-sync (transparent-sync plan §6; ADR 0006 D4). Use the credential-aware
    // diagnosis — NOT capabilitiesFor().canSync, which is hasRemote-only and would
    // run syncProject on every trigger for SSH or uncredentialed-HTTPS projects
    // (each returning auth/error, churning the network unattended). Same gate the
    // renderer pill is shown on, so host and UI agree.
    const diag = await lib.diagnoseProjectRemote(dir, { tokenStore: this.deps.tokenStore });
    if (!diag.canSync) return;

    state.inFlight = true;
    this.deps.emit({ state: "syncing", projectDir: dir, lastSyncAt: this.getLastSyncAt(dir) });

    // Compute the operation log path for this project so sync + recovery share
    // one log file the user can view when something goes wrong.
    const dirBasename = path.basename(dir);
    const logFile = this.deps.operationLogPath(dirBasename);

    let outcome: SyncOutcome;
    try {
      outcome = await lib.syncProject({
        projectDir: dir,
        tokenStore: this.deps.tokenStore,
        logFile,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[auto-sync] syncProject threw for ${dir}: ${msg}`);
      const now = this.nowIso();
      this.setLastSyncAt(dir, now);

      // ── Out-of-memory guard ──────────────────────────────────────────────────
      // A RangeError / "Array buffer allocation failed" is a TRANSIENT resource
      // failure (e.g. isomorphic-git reading a large packfile), NOT structural
      // repo damage. It must NEVER trigger the recovery subsystem (backup +
      // reclone) — doing so would zip the whole repo and OOM again. Treat it as a
      // plain transient error; the snapshot already saved the author's work.
      if (e instanceof RangeError || /allocation failed|out of memory|heap/i.test(msg)) {
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        state.inFlight = false;
        if (state.runAgain) {
          state.runAgain = false;
          void this.run(dir);
        }
        return;
      }

      // ── Recovery routing (Foundation delta) ──────────────────────────────────
      // Classify the error. If classifiable, route through recover(). Otherwise
      // keep the old behavior (emit 'error', allow future attempts).
      let kind: SyncErrorKind;
      let health: RepoHealth | undefined;
      try {
        health = await lib.inspectRepo({ repoDir: dir });
        kind = lib.classifyGitError(e, health);
      } catch {
        kind = "unknown";
      }

      if (kind === "unknown") {
        // Old behavior — no recovery attempt for unclassifiable errors.
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        state.inFlight = false;
        if (state.runAgain) {
          state.runAgain = false;
          void this.run(dir);
        }
        return;
      }

      // Emit 'recovering' so the UI can show the non-intrusive overlay.
      // Include `risk: "none"` to satisfy RecoveryProgressInfo (both fields required).
      this.deps.emit({
        state: "recovering",
        projectDir: dir,
        lastSyncAt: now,
        recovery: { phase: "checking", risk: "none" },
      });

      // Build the RecoveryContext (resolves repoDir, credential, etc.).
      // Uses the same lib/tokenStore already in scope.
      let ctx: RecoveryContext;
      try {
        ctx = await this.deps.buildRecoveryContext(dir, lib, this.deps.tokenStore, undefined, logFile);
      } catch (ctxErr) {
        console.error(`[auto-sync] buildRecoveryContext failed for ${dir}:`, ctxErr);
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        state.inFlight = false;
        return;
      }

      let result: Awaited<ReturnType<typeof lib.recover>>;
      try {
        result = await lib.recover(kind, ctx, e);
      } catch (recoverErr) {
        console.error(`[auto-sync] recover() threw for ${dir}:`, recoverErr);
        this.deps.emit({ state: "error", projectDir: dir, lastSyncAt: now });
        state.inFlight = false;
        return;
      } finally {
        // Single-flight invariant: always reset, even on throw.
        state.inFlight = false;
      }

      // Map RecoveryResult → emit via the ONE shared mapper (also used by the
      // api:preview preflight). The mapper owns the payload SHAPE; the follow-up
      // actions below (single-flight runAgain, retry timer, conflict latch) are
      // the orchestrator's own invariants and stay here. `recovered` uses a
      // fresher post-recover timestamp (matching the original code); every other
      // branch uses the catch-time `now`.
      if (result.status === "recovered") {
        this.setLastSyncAt(dir, this.nowIso());
      }
      const em = mapRecoveryResultToEmit(result, {
        projectDir: dir,
        lastSyncAt: result.status === "recovered" ? (this.getLastSyncAt(dir) ?? now) : now,
        logFile,
        authlessNeedsUserAs: "auth",
      });
      switch (em.kind) {
        case "recovered": {
          this.deps.emit(em.status);
          // Resume the single-flight follow-up path.
          if (state.runAgain) {
            state.runAgain = false;
            void this.run(dir);
          }
          break;
        }

        case "retry_later": {
          this.deps.emit(em.status);
          // Re-arm after the requested delay.
          const retryTimer = setTimeout(() => {
            if (this.states.has(dir)) void this.run(dir);
          }, em.retryAfterMs ?? 60_000);
          if (typeof retryTimer.unref === "function") retryTimer.unref();
          break;
        }

        case "auth":
          // Auth / credential issue — no latch, no follow-up.
          this.deps.emit(em.status);
          break;

        case "conflict":
        case "error": {
          // Latch: do not churn on a conflict or a structural failure the
          // recovery subsystem says is blocked. Cancel the periodic timer
          // consistent with the normal conflict path, then surface the status.
          state.conflictLatched = true;
          state.runAgain = false;
          this.cancelTimer(dir);
          this.deps.emit(em.status);
          break;
        }
      }
      return;
    }

    state.inFlight = false;

    // Record the completion timestamp for this dir; included in every subsequent emit.
    const completedAt = this.nowIso();
    this.setLastSyncAt(dir, completedAt);

    // Map outcome → ambient status emit.
    switch (outcome.status) {
      case "synced":
      case "up-to-date":
        this.deps.emit({
          state: outcome.status,
          projectDir: dir,
          lastSyncAt: completedAt,
          ...(outcome.filesChanged ? { filesChanged: true } : {}),
        });
        break;

      case "conflict":
        // Latch: disable auto-sync for this project until the user resolves.
        state.conflictLatched = true;
        this.cancelTimer(dir);
        this.deps.emit({
          state: "conflict",
          // M13: carry localId/remoteId directly so the renderer never needs a
          // second network sync just to unlock ConflictChoicesDialog's primary
          // button. L12: attach the host-authoritative isBinary per file.
          files: outcome.files.map((f) => ({ ...f, isBinary: isConflictFileBinary(f.path) })),
          projectDir: dir,
          lastSyncAt: completedAt,
          localId: outcome.localId,
          remoteId: outcome.remoteId,
        });
        console.warn(`[auto-sync] conflict latched for ${dir} — auto-sync paused until resolved`);
        // Conflict-latch prevents the runAgain path from firing.
        state.runAgain = false;
        return;

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
   * STILL the watched project when the timer expires (a project switch cancels
   * the stale run). Unref'd so it never blocks app quit. Private: the only
   * caller is runPreflight, below — main.ts's own analogous "local status"
   * re-emit timer is unrelated (no run() call) and stays in main.ts.
   */
  private scheduleDeferredSync(dir: string, delayMs: number): void {
    const t = setTimeout(() => {
      if (this.deps.getWatchedDir() === dir) void this.run(dir);
    }, delayMs);
    if (typeof t.unref === "function") t.unref();
  }

  // ── Preflight recovery (project-open, before the first sync) ───────────────

  /**
   * Preflight recovery: before the initial sync, inspect `dir`'s repo for
   * structural conditions (stale lock, interrupted merge, detached head,
   * missing git dir). If a recoverable condition is detected, route through
   * `lib.recover()` BEFORE the first `run()` so the author sees a transparent
   * repair on open rather than a sync error. No-op for non-git projects (a
   * deferred sync is scheduled immediately instead).
   *
   * CONCURRENCY: acquires the single-flight lock for the duration of
   * `lib.recover()` so `run()` cannot call `lib.syncProject` concurrently on
   * the same repo — if `run()` fires while the lock is held (e.g. the periodic
   * interval), it arms `runAgain` instead, and this method honours (or
   * intentionally suppresses, per the conflict-latch invariant) that pending
   * trigger once `recover()` settles (BUG 3 — see decideRunAgainAfterPreflight).
   * Never throws — every step is wrapped so a failure here can't wedge the
   * project; a deferred sync is always scheduled as the fallback.
   *
   * Formerly a ~140-line IIFE hand-rolled in main.ts's handlePreviewRequest
   * (finding #7, 2026-07-10 architecture review): the caller took the
   * single-flight lock itself, released it at four sites, and hand-wrote the
   * conflict-latch / runAgain bookkeeping this class exists to own.
   */
  async runPreflight(dir: string, source: ProjectSourceResult): Promise<void> {
    // Acquire single-flight lock before any git I/O. Skip preflight entirely
    // (no runAgain marking — unlike run()'s own guard) if a sync is already in
    // flight; unusual at open time, but never worth queuing a preflight retry.
    if (!this.acquire(dir)) return;
    const state = this.getOrCreateState(dir);

    // Declared outside the try so the catch block can log to the same file even
    // if a step before ctx-creation throws (guarded: may still be undefined).
    let plog: ReturnType<LibModule["resolveLogger"]> | undefined;

    try {
      const lib = await this.deps.loadLib();

      if (source.type !== "local-git-folder") {
        // Not a git project — release immediately and let the normal initial sync proceed.
        this.release(dir);
        this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      const health = await lib.inspectRepo({ repoDir: dir });
      const kind = lib.classifyFromHealth(health) as SyncErrorKind | null;
      if (kind === null) {
        // Healthy repo — release lock and schedule the normal initial sync.
        this.release(dir);
        this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
        return;
      }

      console.log(
        `[preflight] structural condition '${kind}' detected for ${dir}; recovering before first sync`,
      );
      this.deps.emit({
        state: "recovering",
        projectDir: dir,
        lastSyncAt: this.getLastSyncAt(dir) ?? null,
        recovery: { phase: "checking", risk: "none" },
      });

      const preflightLogFile = this.deps.operationLogPath(path.basename(dir));
      const ctx = await this.deps.buildRecoveryContext(
        dir,
        lib,
        this.deps.tokenStore,
        undefined,
        preflightLogFile,
      );

      // Write the FULL structural diagnosis to the operation log BEFORE
      // dispatching recover(), so support sees WHY a kind was chosen (which
      // health signal, repo root vs opened dir, whether local changes
      // existed) — not just a one-word kind. Same file + format the recovery
      // subsystem itself writes to.
      plog = lib.resolveLogger(preflightLogFile, "preflight");
      plog.info(
        "detect",
        "structural condition detected on open",
        lib.buildPreflightDiagnostics(dir, ctx.repoDir, health, kind),
      );

      let result: Awaited<ReturnType<LibModule["recover"]>>;
      try {
        result = await lib.recover(kind, ctx);
      } finally {
        // Always release the single-flight lock when recover() settles.
        this.release(dir);
      }

      const now = this.nowIso();
      this.setLastSyncAt(dir, now);

      // Snapshot the pending auto-sync trigger BEFORE the per-status branches:
      // run() may have set runAgain while we held the single-flight lock. A
      // single authoritative decision below (decideRunAgainAfterPreflight)
      // decides its fate so it is never silently dropped (BUG 3). The latching
      // branches still clear runAgain themselves for their own emit logic; the
      // post-chain decision is the one place that may actually re-run it.
      const pendingRunAgain = state.runAgain;

      // Map recover()'s result → emit payload via the ONE shared mapper (also
      // used by run()). The preflight surfaces an authless needs_user as a
      // generic error (its historical else-branch), hence
      // authlessNeedsUserAs: "error". The follow-up (resume / retry timer /
      // conflict-latch) is preflight's own and stays here.
      const em = mapRecoveryResultToEmit(result, {
        projectDir: dir,
        lastSyncAt: now,
        logFile: preflightLogFile,
        authlessNeedsUserAs: "error",
      });

      if (em.kind === "recovered") {
        this.deps.emit(em.status);
        // The repo is healthy again: clear any conflict-latch and RESUME sync
        // so the fix isn't left paused. If a trigger was already queued while
        // we held the lock, decideRunAgainAfterPreflight below will run it
        // ("run") — so only schedule the deferred sync here when nothing is
        // queued, to avoid a double-run on the same repo.
        state.conflictLatched = false;
        if (!pendingRunAgain) {
          plog.info("resume", "recovered — scheduling deferred sync", {
            reason: "no queued trigger",
          });
          this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
        } else {
          plog.info("resume", "recovered — honoring queued trigger", {
            reason: "runAgain pending",
          });
        }
      } else if (em.kind === "retry_later") {
        this.deps.emit(em.status);
        // Honor the handler's requested delay (same idiom as the mid-sync
        // retry_later arm) instead of waiting for the generic periodic timer.
        this.scheduleDeferredSync(dir, em.retryAfterMs ?? 60_000);
      } else {
        // conflict OR error (blocked / failed / needs_user without files) —
        // latch, stop the periodic timer to avoid churning, and surface.
        state.conflictLatched = true;
        state.runAgain = false;
        this.cancelTimer(dir);
        this.deps.emit(em.status);
      }

      // Honour (or intentionally suppress) the pending auto-sync trigger now
      // that recover() has settled and the lock is released. For non-latching
      // outcomes (recovered / retry_later) a queued trigger PROCEEDS. For
      // latching outcomes (conflict/blocked/failed) the latch suppresses it.
      // Always clear the flag so it can't leak into a later run.
      const runAgainDecision = this.decideRunAgainAfterPreflight(result.status, pendingRunAgain);
      state.runAgain = false;
      if (runAgainDecision === "run") {
        void this.run(dir);
      }
    } catch (err) {
      // Preflight is non-blocking: always release the lock so the project is
      // not permanently wedged. Then let the normal initial sync proceed.
      this.release(dir);
      console.warn("[preflight] recovery failed (non-fatal):", err);
      plog?.error("preflight", "recovery failed (non-fatal)", { error: String(err) });
      this.scheduleDeferredSync(dir, AUTO_SYNC_OPEN_DELAY_MS);
    }
  }
}
