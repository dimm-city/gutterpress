import { expect, test } from "bun:test";
import {
  AutoSyncOrchestrator,
  type AutoSyncOrchestratorDeps,
  type SyncStatusPayload,
} from "../../electron/auto-sync/orchestrator";
import { mapRecoveryResultToEmit } from "../../electron/auto-sync/recovery-emit";

type LibModule = typeof import("@dimm-city/print-md");

const DIR = "/book";

/** Wait for pending microtasks/timers to settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

interface Harness {
  orch: AutoSyncOrchestrator;
  emitted: SyncStatusPayload[];
  /** Every projectDir passed to lib.syncProject, in call order. */
  syncCalls: string[];
  /** Every dir passed to deps.refreshHeartbeat, in call order. */
  heartbeatCalls: string[];
  /** Advance the fake clock. */
  setClock: (ms: number) => void;
}

interface FakeLibOptions {
  autoSyncDelayMs?: number | null;
  autoSnapshotDelayMs?: number | null;
  sourceType?: string;
  canSync?: boolean;
  /** Called per syncProject invocation; returns the SyncOutcome (or a promise). */
  syncProject?: (projectDir: string) => unknown;
  /** SyncErrorKind returned by classifyGitError (drives the recover() path). */
  classifyGitError?: string;
  /** RecoveryResult returned by lib.recover (the recover()/runPreflight path). */
  recover?: () => unknown;
  /** SyncErrorKind|null returned by classifyFromHealth (drives runPreflight's
   *  structural-condition branch). Default null (healthy repo). */
  classifyFromHealth?: () => string | null;
  /** When set, diagnoseProjectRemote rejects with this — to exercise the
   *  probe-failure path in run() (code-review: must release the lock). */
  diagnoseThrows?: Error;
}

/** A minimal local-git-folder ProjectSource for runPreflight tests. */
const LOCAL_GIT_SOURCE = {
  type: "local-git-folder" as const,
  path: DIR,
  repoRoot: DIR,
  subPath: "",
  hasRemote: true,
};

function makeHarness(opts: FakeLibOptions = {}): Harness {
  const emitted: SyncStatusPayload[] = [];
  const syncCalls: string[] = [];
  let clock = 1_700_000_000_000;

  const lib = {
    autoSyncDelayMs: () =>
      opts.autoSyncDelayMs === undefined ? 120_000 : opts.autoSyncDelayMs,
    autoSnapshotDelayMs: () =>
      opts.autoSnapshotDelayMs === undefined ? 600_000 : opts.autoSnapshotDelayMs,
    detectProjectSource: async () => ({ type: opts.sourceType ?? "local-git-folder" }),
    diagnoseProjectRemote: async () => {
      if (opts.diagnoseThrows) throw opts.diagnoseThrows;
      return { canSync: opts.canSync ?? true };
    },
    syncProject: async ({ projectDir }: { projectDir: string }) => {
      syncCalls.push(projectDir);
      const r = opts.syncProject
        ? await opts.syncProject(projectDir)
        : { status: "synced" };
      return r;
    },
    inspectRepo: async () => ({}),
    classifyGitError: () => opts.classifyGitError ?? "unknown",
    recover: async () => (opts.recover ? opts.recover() : { status: "recovered", message: "ok" }),
    classifyFromHealth: () => (opts.classifyFromHealth ? opts.classifyFromHealth() : null),
    resolveLogger: () => ({ info: () => {}, error: () => {} }),
    buildPreflightDiagnostics: () => ({}),
  } as unknown as LibModule;

  const heartbeatCalls: string[] = [];

  const deps: AutoSyncOrchestratorDeps = {
    loadLib: async () => lib,
    tokenStore: {} as AutoSyncOrchestratorDeps["tokenStore"],
    readSettings: async () => ({ versionHistory: {} as never }),
    emit: (p) => emitted.push(p),
    now: () => clock,
    getWatchedDir: () => DIR,
    operationLogPath: (slug) => `/logs/${slug}.log`,
    buildRecoveryContext: async () => ({}) as never,
    refreshHeartbeat: (dir) => heartbeatCalls.push(dir),
  };

  return {
    orch: new AutoSyncOrchestrator(deps),
    emitted,
    syncCalls,
    heartbeatCalls,
    setClock: (ms) => {
      clock = ms;
    },
  };
}

test("concurrent triggers coalesce to exactly one queued follow-up run", async () => {
  // Gate the FIRST syncProject so it stays in flight while we fire more triggers.
  let firstCalledResolve: () => void;
  const firstCalled = new Promise<void>((r) => (firstCalledResolve = r));
  let releaseFirst: () => void;

  let n = 0;
  const h = makeHarness({
    syncProject: () => {
      n += 1;
      if (n === 1) {
        firstCalledResolve();
        return new Promise((res) => {
          releaseFirst = () => res({ status: "synced" });
        });
      }
      return { status: "synced" };
    },
  });

  const p1 = h.orch.run(DIR); // enters, awaits guards, sets inFlight, blocks in syncProject
  await firstCalled; // first sync is now in flight

  // Fire two more triggers while the first is still in flight: both must coalesce
  // into a SINGLE runAgain, not two queued syncs.
  await h.orch.run(DIR);
  await h.orch.run(DIR);

  releaseFirst!();
  await p1;
  await tick();

  // Total syncProject calls: the original + exactly one coalesced follow-up.
  expect(h.syncCalls.length).toBe(2);
});

test("a probe failure releases the single-flight lock (code-review: no wedge)", async () => {
  // With inFlight now claimed BEFORE the policy probes, a thrown probe must
  // still release it — otherwise every future trigger only arms runAgain and
  // auto-sync is wedged until restart.
  const opts: FakeLibOptions = { diagnoseThrows: new Error("network down") };
  const h = makeHarness(opts);

  await expect(h.orch.run(DIR)).rejects.toThrow("network down");
  // The lock is released, not stuck true.
  expect(h.orch.getState(DIR)?.inFlight).toBe(false);
  expect(h.syncCalls.length).toBe(0);

  // The probe recovers; the SAME orchestrator is NOT wedged — the next trigger
  // proceeds all the way through syncProject.
  opts.diagnoseThrows = undefined;
  await h.orch.run(DIR);
  expect(h.orch.getState(DIR)?.inFlight).toBe(false);
  expect(h.syncCalls.length).toBe(1);
});

test("a 'conflict' outcome latches auto-sync and blocks subsequent runs", async () => {
  const h = makeHarness({
    syncProject: () => ({ status: "conflict", files: [{ path: "a.md" }] }),
  });

  await h.orch.run(DIR);
  await tick();

  const state = h.orch.getState(DIR);
  expect(state?.conflictLatched).toBe(true);
  expect(h.emitted.some((e) => e.state === "conflict")).toBe(true);

  // A subsequent trigger while latched must NOT touch the network.
  const before = h.syncCalls.length;
  await h.orch.run(DIR);
  await tick();
  expect(h.syncCalls.length).toBe(before);
});

test("a 'conflict' outcome carries localId/remoteId and per-file isBinary on the emit (M13/L12)", async () => {
  const h = makeHarness({
    syncProject: () => ({
      status: "conflict",
      files: [{ path: "a.md", kind: "both-edited" }, { path: "cover.png", kind: "both-edited" }],
      localId: "LOCAL1",
      remoteId: "REMOTE1",
    }),
  });

  await h.orch.run(DIR);
  await tick();

  const conflictEmit = h.emitted.find((e) => e.state === "conflict");
  expect(conflictEmit?.localId).toBe("LOCAL1");
  expect(conflictEmit?.remoteId).toBe("REMOTE1");
  expect(conflictEmit?.files).toEqual([
    { path: "a.md", kind: "both-edited", isBinary: false },
    { path: "cover.png", kind: "both-edited", isBinary: true },
  ]);
});

test("clearing the latch re-enables syncing", async () => {
  const h = makeHarness({
    syncProject: () => ({ status: "conflict", files: [{ path: "a.md" }] }),
  });
  await h.orch.run(DIR);
  await tick();
  expect(h.orch.getState(DIR)?.conflictLatched).toBe(true);

  // Explicit user resolution clears the latch (mirrors main.ts resolveConflicts).
  h.orch.unlatch(DIR);
  const before = h.syncCalls.length;
  await h.orch.run(DIR);
  await tick();
  expect(h.syncCalls.length).toBe(before + 1);
});

test("armInterval arms exactly one interval and cancelTimer cancels it", async () => {
  const h = makeHarness();

  await h.orch.armInterval(DIR);
  const handle1 = h.orch.getState(DIR)?.intervalHandle;
  expect(handle1).toBeTruthy();

  // Idempotent: a second arm does not replace the running interval.
  await h.orch.armInterval(DIR);
  expect(h.orch.getState(DIR)?.intervalHandle).toBe(handle1!);

  h.orch.cancelTimer(DIR);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeNull();
});

test("armInterval is a no-op when auto-sync is disabled by policy", async () => {
  const h = makeHarness({ autoSyncDelayMs: null });
  await h.orch.armInterval(DIR);
  // No state row is even created for a disabled interval past the policy gate.
  expect(h.orch.getState(DIR)?.intervalHandle ?? null).toBeNull();
});

test("armInterval does not arm while conflict-latched", async () => {
  const h = makeHarness();
  h.orch.latchConflict(DIR, []);
  await h.orch.armInterval(DIR);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeNull();
});

test("run() refreshes the app-open heartbeat for its dir (M2)", async () => {
  const h = makeHarness();
  await h.orch.run(DIR);
  expect(h.heartbeatCalls).toEqual([DIR]);
});

test("run() refreshes the heartbeat even on an early-return guard path", async () => {
  // sourceType other than local-git-folder short-circuits run() before any
  // network call — heartbeat refresh must still have fired first.
  const h = makeHarness({ sourceType: "local-folder" });
  await h.orch.run(DIR);
  expect(h.heartbeatCalls).toEqual([DIR]);
  expect(h.syncCalls).toEqual([]);
});

test("the periodic safety-sync interval refreshes the heartbeat on tick, with no dedicated timer", async () => {
  // A real (short) interval — proves the heartbeat refresh piggybacks on the
  // actual periodic tick armInterval schedules, not a separate timer.
  const h = makeHarness({ autoSyncDelayMs: 5 });
  await h.orch.armInterval(DIR);
  await new Promise((r) => setTimeout(r, 60));
  h.orch.cancelTimer(DIR);
  expect(h.heartbeatCalls.length).toBeGreaterThan(0);
  expect(h.heartbeatCalls.every((d) => d === DIR)).toBe(true);
});

test("armDebounce arms a debounce timer", async () => {
  const h = makeHarness();
  await h.orch.armDebounce(DIR);
  expect(h.orch.getState(DIR)?.debounceTimer).toBeTruthy();
  h.orch.cancelTimer(DIR);
  expect(h.orch.getState(DIR)?.debounceTimer).toBeNull();
});

test("cancelAll clears every tracked dir and its timers", async () => {
  const h = makeHarness();
  await h.orch.armInterval(DIR);
  expect(h.orch.hasState(DIR)).toBe(true);
  h.orch.cancelAll();
  expect(h.orch.hasState(DIR)).toBe(false);
});

test("run is skipped for non-git projects", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  await h.orch.run(DIR);
  await tick();
  expect(h.syncCalls.length).toBe(0);
});

test("run is skipped when the project cannot sync (no credential)", async () => {
  const h = makeHarness({ canSync: false });
  await h.orch.run(DIR);
  await tick();
  expect(h.syncCalls.length).toBe(0);
});

test("a successful run emits syncing then synced with a fake-clock timestamp", async () => {
  const h = makeHarness({ syncProject: () => ({ status: "synced", filesChanged: true }) });
  h.setClock(1_700_000_123_000);
  await h.orch.run(DIR);
  await tick();

  expect(h.emitted[0]?.state).toBe("syncing");
  const done = h.emitted.find((e) => e.state === "synced");
  expect(done?.filesChanged).toBe(true);
  expect(done?.lastSyncAt).toBe(new Date(1_700_000_123_000).toISOString());
  expect(h.orch.getLastSyncAt(DIR)).toBe(new Date(1_700_000_123_000).toISOString());
});

test("the recover() path emits exactly what the shared mapper produces", async () => {
  // Drive the error → classify → recover branch: syncProject throws, the error
  // classifies to a known kind, and recover() returns a needs_user CONFLICT.
  const recoveryResult = {
    status: "needs_user",
    message: "conflict",
    guidance: { title: "t" },
    files: [{ path: "a.md" }],
  };
  const h = makeHarness({
    syncProject: () => {
      throw new Error("push rejected");
    },
    classifyGitError: "non_fast_forward",
    recover: () => recoveryResult,
  });
  h.setClock(1_700_000_777_000);
  await h.orch.run(DIR);
  await tick();

  // The orchestrator maps needs_user-with-files to a conflict via the SHARED
  // mapper (authlessNeedsUserAs="auth"). The emitted payload must match the
  // mapper's output byte-for-byte.
  const now = new Date(1_700_000_777_000).toISOString();
  const expected = mapRecoveryResultToEmit(recoveryResult as never, {
    projectDir: DIR,
    lastSyncAt: now,
    logFile: `/logs/${DIR.replace(/^\//, "")}.log`,
    authlessNeedsUserAs: "auth",
  });
  const conflictEmit = h.emitted.find((e) => e.state === "conflict");
  expect(conflictEmit).toEqual(expected.status);
  // and the conflict latched (orchestrator follow-up on the "conflict" bucket).
  expect(h.orch.getState(DIR)?.conflictLatched).toBe(true);
});

test("decideRunAgainAfterPreflight delegates the pure rule", () => {
  const h = makeHarness();
  expect(h.orch.decideRunAgainAfterPreflight("recovered", true)).toBe("run");
  expect(h.orch.decideRunAgainAfterPreflight("retry_later", true)).toBe("run");
  expect(h.orch.decideRunAgainAfterPreflight("needs_user", true)).toBe("suppress");
  expect(h.orch.decideRunAgainAfterPreflight("blocked", true)).toBe("suppress");
  expect(h.orch.decideRunAgainAfterPreflight("recovered", false)).toBe("none");
});

// ── External single-flight lock surface: acquire/release (finding #7) ────────
// These exist so a caller OUTSIDE run() (runPreflight) can hold the exact same
// lock across a multi-step async flow without reaching into the state bag.

test("acquire succeeds when free and fails while held; release frees it again", () => {
  const h = makeHarness();
  expect(h.orch.acquire(DIR)).toBe(true);
  expect(h.orch.acquire(DIR)).toBe(false); // already held
  h.orch.release(DIR);
  expect(h.orch.acquire(DIR)).toBe(true);
});

test("release is a no-op for an untracked dir (never creates state)", () => {
  const h = makeHarness();
  h.orch.release("/never-tracked");
  expect(h.orch.hasState("/never-tracked")).toBe(false);
});

// ── Conflict-latch surface: latchConflict/unlatch/isConflictLatched ─────────
// The ONE mutation surface for a conflict detected OUTSIDE run() (currently:
// ExportController's pre-export sync gate) and the explicit-resolution path
// (remote:resolveSyncConflicts) — replacing the old getState()/getOrCreateState()
// reach-in-and-mutate pattern the finding calls out.

test("latchConflict sets the latch, cancels timers, stamps lastSyncAt, and emits conflict", async () => {
  const h = makeHarness();
  await h.orch.armInterval(DIR); // arm a timer so we can prove latchConflict cancels it
  expect(h.orch.getState(DIR)?.intervalHandle).toBeTruthy();

  h.setClock(1_700_000_555_000);
  h.orch.latchConflict(DIR, [{ path: "a.md" } as never]);

  expect(h.orch.isConflictLatched(DIR)).toBe(true);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeNull();
  expect(h.orch.getLastSyncAt(DIR)).toBe(new Date(1_700_000_555_000).toISOString());
  const conflictEmit = h.emitted.find((e) => e.state === "conflict");
  expect(conflictEmit?.projectDir).toBe(DIR);
  // L12: isBinary is attached per file using the host-authoritative extension
  // classifier (isConflictFileBinary) — ".md" is not binary.
  expect(conflictEmit?.files).toEqual([{ path: "a.md", isBinary: false }]);
  // M13: latchConflict's 2-arg callers (export/controller.ts's pre-export
  // gate) don't have ids to pass, so they stay absent on this emit site.
  expect(conflictEmit?.localId).toBeUndefined();
  expect(conflictEmit?.remoteId).toBeUndefined();
});

test("latchConflict carries localId/remoteId through to the emit when the caller has them (M13)", () => {
  const h = makeHarness();
  h.orch.latchConflict(DIR, [{ path: "cover.png" } as never], "L1", "R1");
  const conflictEmit = h.emitted.find((e) => e.state === "conflict");
  expect(conflictEmit?.localId).toBe("L1");
  expect(conflictEmit?.remoteId).toBe("R1");
  // L12: a real binary extension is classified true.
  expect(conflictEmit?.files).toEqual([{ path: "cover.png", isBinary: true }]);
});

test("unlatch clears the latch without emitting", () => {
  const h = makeHarness();
  h.orch.latchConflict(DIR, []);
  expect(h.orch.isConflictLatched(DIR)).toBe(true);
  const before = h.emitted.length;
  h.orch.unlatch(DIR);
  expect(h.orch.isConflictLatched(DIR)).toBe(false);
  expect(h.emitted.length).toBe(before);
});

test("unlatch is a no-op for an untracked dir", () => {
  const h = makeHarness();
  h.orch.unlatch("/never-tracked");
  expect(h.orch.hasState("/never-tracked")).toBe(false);
});

test("isConflictLatched is false for an untracked dir", () => {
  const h = makeHarness();
  expect(h.orch.isConflictLatched("/never-tracked")).toBe(false);
});

// ── runPreflight ──────────────────────────────────────────────────────────────
// Formerly a ~140-line IIFE hand-rolled in main.ts (finding #7). These pin the
// single-flight / conflict-latch / runAgain(BUG 3) semantics on the extracted
// method.

test("runPreflight: non-git source releases the lock without any git I/O", async () => {
  const h = makeHarness();
  await h.orch.runPreflight(DIR, { type: "local-folder", path: DIR });
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: healthy repo (classifyFromHealth → null) releases the lock without calling recover", async () => {
  let recoverCalled = false;
  const h = makeHarness({
    classifyFromHealth: () => null,
    recover: () => {
      recoverCalled = true;
      return { status: "recovered", message: "ok" };
    },
  });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(recoverCalled).toBe(false);
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: skips entirely when the lock is already held", async () => {
  let recoverCalled = false;
  const h = makeHarness({
    classifyFromHealth: () => "stale_lock",
    recover: () => {
      recoverCalled = true;
      return { status: "recovered", message: "ok" };
    },
  });
  expect(h.orch.acquire(DIR)).toBe(true); // hold the lock externally first
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(recoverCalled).toBe(false);
  expect(h.orch.acquire(DIR)).toBe(false); // still held — runPreflight never touched it
});

test("runPreflight: a structural condition + recovered result clears an existing latch, emits recovered, and releases the lock", async () => {
  const h = makeHarness({
    classifyFromHealth: () => "stale_lock",
    recover: () => ({ status: "recovered", message: "ok" }),
  });
  h.orch.latchConflict(DIR, []); // pre-latch so we can prove recovery clears it
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);

  expect(h.orch.isConflictLatched(DIR)).toBe(false);
  expect(h.emitted.some((e) => e.state === "recovered")).toBe(true);
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: a conflict/error result latches, cancels the timer, and leaves runAgain cleared", async () => {
  const h = makeHarness({
    classifyFromHealth: () => "merge_conflict",
    recover: () => ({ status: "blocked", message: "m", guidance: {} }),
  });
  await h.orch.armInterval(DIR);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeTruthy();

  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);

  expect(h.orch.isConflictLatched(DIR)).toBe(true);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeNull();
  expect(h.orch.getState(DIR)?.runAgain).toBe(false);
  expect(h.emitted.some((e) => e.state === "error")).toBe(true);
  expect(h.orch.acquire(DIR)).toBe(true); // lock released even on the latching branch
});

test("runPreflight: retry_later emits an offline status and re-arms run() after the requested delay", async () => {
  const h = makeHarness({
    classifyFromHealth: () => "stale_lock",
    recover: () => ({ status: "retry_later", message: "m", retryAfterMs: 5 }),
    syncProject: () => ({ status: "synced" }),
  });

  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.emitted.some((e) => e.state === "offline")).toBe(true);

  // The retry timer re-arms run() after retryAfterMs (guarded by getWatchedDir).
  await new Promise((r) => setTimeout(r, 40));
  expect(h.syncCalls).toEqual([DIR]);
});

test("runPreflight (BUG 3): a runAgain queued mid-recover() is honored once the lock releases", async () => {
  // Gate lib.recover() so it stays in flight until we explicitly release it,
  // and signal once it's actually been called (runPreflight reaches it only
  // after several awaits — loadLib, inspectRepo, buildRecoveryContext).
  let recoverCalledResolve: () => void;
  const recoverCalled = new Promise<void>((r) => (recoverCalledResolve = r));
  let releaseRecover: (() => void) | null = null;
  const h = makeHarness({
    classifyFromHealth: () => "stale_lock",
    recover: () => {
      recoverCalledResolve();
      return new Promise((resolve) => {
        releaseRecover = () => resolve({ status: "recovered", message: "ok" });
      });
    },
    syncProject: () => ({ status: "synced" }),
  });

  const p = h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  await recoverCalled; // recover() is now in flight, holding the single-flight lock

  // A trigger fires while the lock is held: run() queues runAgain instead of syncing.
  await h.orch.run(DIR);
  expect(h.orch.getState(DIR)?.runAgain).toBe(true);
  expect(h.syncCalls).toEqual([]);

  releaseRecover!();
  await p;
  await tick();

  // The queued trigger was honored (not silently dropped) once recover() settled.
  expect(h.syncCalls).toEqual([DIR]);
  expect(h.orch.getState(DIR)?.runAgain).toBe(false);
});

test("runPreflight: a thrown step is non-fatal and always releases the lock", async () => {
  const h = makeHarness({
    classifyFromHealth: () => {
      throw new Error("boom");
    },
  });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.orch.acquire(DIR)).toBe(true); // lock released in the catch branch
});
