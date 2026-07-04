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
  /** RecoveryResult returned by lib.recover (the recover() path). */
  recover?: () => unknown;
}

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
    diagnoseProjectRemote: async () => ({ canSync: opts.canSync ?? true }),
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
  } as unknown as LibModule;

  const deps: AutoSyncOrchestratorDeps = {
    loadLib: async () => lib,
    tokenStore: {} as AutoSyncOrchestratorDeps["tokenStore"],
    readSettings: async () => ({ versionHistory: {} as never }),
    emit: (p) => emitted.push(p),
    now: () => clock,
    getWatchedDir: () => DIR,
    operationLogPath: (slug) => `/logs/${slug}.log`,
    buildRecoveryContext: async () => ({}) as never,
  };

  return {
    orch: new AutoSyncOrchestrator(deps),
    emitted,
    syncCalls,
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

test("clearing the latch re-enables syncing", async () => {
  const h = makeHarness({
    syncProject: () => ({ status: "conflict", files: [{ path: "a.md" }] }),
  });
  await h.orch.run(DIR);
  await tick();
  expect(h.orch.getState(DIR)?.conflictLatched).toBe(true);

  // Explicit user resolution clears the latch (mirrors main.ts resolveConflicts).
  h.orch.getOrCreateState(DIR).conflictLatched = false;
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
  h.orch.getOrCreateState(DIR).conflictLatched = true;
  await h.orch.armInterval(DIR);
  expect(h.orch.getState(DIR)?.intervalHandle).toBeNull();
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
