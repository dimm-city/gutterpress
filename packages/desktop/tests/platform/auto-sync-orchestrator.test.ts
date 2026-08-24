import { expect, test } from "bun:test";
import {
  AutoSyncOrchestrator,
  type AutoSyncOrchestratorDeps,
  type SyncStatusPayload,
} from "../../electron/auto-sync/orchestrator";

type LibModule = typeof import("gutterpress");

const DIR = "/book";

/** Wait for pending microtasks/timers to settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Poll until `pred()` holds, bounded by `timeoutMs`. Waits for the observable
 * effect of the orchestrator's REAL internal timers instead of sleeping a fixed
 * duration (which is fragile under full-suite concurrency).
 */
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = performance.now();
  while (!pred()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Harness {
  orch: AutoSyncOrchestrator;
  emitted: SyncStatusPayload[];
  /** Every projectDir passed to lib.syncProject, in call order. */
  syncCalls: string[];
  /** Full args of every lib.syncProject call, in order. */
  syncArgs: unknown[];
  /** Full args of every lib.repairRepo call, in order. */
  repairCalls: unknown[];
  /** Advance the fake clock. */
  setClock: (ms: number) => void;
}

interface FakeLibOptions {
  /** The repo root the fake classification reports (a nested book's enclosing repo). */
  repoRoot?: string;
  /** The book's path relative to `repoRoot` ("" when the book IS the repo root). */
  subPath?: string;
  autoSyncDelayMs?: number | null;
  sourceType?: string;
  canSync?: boolean;
  /** Called per syncProject invocation; returns the SyncOutcome (or a promise). */
  syncProject?: (projectDir: string) => unknown;
  /** True when a thrown sync error should look like local repo corruption. */
  looksLikeCorruption?: boolean;
  /** RepairResult returned by lib.repairRepo (the repair/runPreflight path). */
  repair?: () => unknown;
  /** RepairNeed|null returned by classifyFromHealth (drives runPreflight's
   *  structural-condition branch). Default null (healthy repo). */
  classifyFromHealth?: () => string | null;
  /** When set, diagnoseProjectRemote rejects with this — to exercise the
   *  probe-failure path in run() (code-review: must release the lock). */
  diagnoseThrows?: Error;
  /** The `gitIdentity` settings slice the orchestrator must honour. */
  gitIdentity?: { authorName?: string; authorEmail?: string };
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
  const syncArgs: unknown[] = [];
  const repairCalls: unknown[] = [];
  let clock = 1_700_000_000_000;

  const lib = {
    autoSyncDelayMs: () =>
      opts.autoSyncDelayMs === undefined ? 120_000 : opts.autoSyncDelayMs,
    detectProjectSource: async () => ({
      type: opts.sourceType ?? "local-git-folder",
      // The real lib always reports the enclosing repo root for a
      // local-git-folder; the operation-log slug is derived from it.
      repoRoot: opts.repoRoot ?? DIR,
      subPath: opts.subPath ?? "",
    }),
    repoRootForSource: (source: { type?: string; repoRoot?: string }, fallbackDir: string) =>
      source?.type === "local-git-folder" ? source.repoRoot || fallbackDir : fallbackDir,
    diagnoseProjectRemote: async () => {
      if (opts.diagnoseThrows) throw opts.diagnoseThrows;
      return { canSync: opts.canSync ?? true };
    },
    syncProject: async (args: { projectDir: string }) => {
      const { projectDir } = args;
      syncCalls.push(projectDir);
      syncArgs.push(args);
      const r = opts.syncProject
        ? await opts.syncProject(projectDir)
        : { status: "synced" };
      return r;
    },
    inspectRepo: async () => ({}),
    isRepoNeedsRecoveryError: (e: unknown) =>
      (e as { code?: string })?.code === "RepoNeedsRecovery",
    isLikelyRepoCorruption: () => opts.looksLikeCorruption ?? false,
    repairRepo: async (args: unknown) => {
      repairCalls.push(args);
      return opts.repair
        ? opts.repair()
        : { status: "repaired", message: "ok", actions: [] };
    },
    classifyFromHealth: () => (opts.classifyFromHealth ? opts.classifyFromHealth() : null),
    resolveLogger: () => ({ info: () => {}, error: () => {} }),
    buildPreflightDiagnostics: () => ({}),
  } as unknown as LibModule;


  const deps: AutoSyncOrchestratorDeps = {
    loadLib: async () => lib,
    tokenStore: {} as AutoSyncOrchestratorDeps["tokenStore"],
    readSettings: async () => ({
      versionHistory: {} as never,
      ...(opts.gitIdentity ? { gitIdentity: opts.gitIdentity } : {}),
    }),
    emit: (p) => emitted.push(p),
    now: () => clock,
    getWatchedDir: () => DIR,
    operationLogPath: (slug) => `/logs/${slug}.log`,
  };

  return {
    orch: new AutoSyncOrchestrator(deps),
    emitted,
    syncCalls,
    syncArgs,
    repairCalls,
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

// ── Configured commit identity ────────────────────────────────────────────────
//
// syncProject snapshots-first (and may write a merge commit), so auto-sync is a
// commit path too: it must carry the author's configured name/email exactly like
// the manual "Save a version" route. It used to pass neither, so every commit it
// produced was attributed to the lib's "Gutterpress" default.

test("run() passes the configured name + email to syncProject", async () => {
  const h = makeHarness({
    gitIdentity: { authorName: "Ada Lovelace", authorEmail: "ada@example.com" },
  });
  await h.orch.run(DIR);
  await tick();
  expect(h.syncArgs.length).toBe(1);
  expect(h.syncArgs[0]).toMatchObject({
    projectDir: DIR,
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
  });
});

test("run() omits blank identity fields instead of sending empty strings", async () => {
  const h = makeHarness({ gitIdentity: { authorName: "  ", authorEmail: "" } });
  await h.orch.run(DIR);
  await tick();
  expect(h.syncArgs[0]).not.toHaveProperty("authorName");
  expect(h.syncArgs[0]).not.toHaveProperty("authorEmail");
});

test("run()'s repair path passes the configured identity + log file to repairRepo", async () => {
  const h = makeHarness({
    syncProject: () => {
      const e = new Error("The project needs repair before it can sync (needs_repair).");
      (e as Error & { code?: string }).code = "RepoNeedsRecovery";
      throw e;
    },
    gitIdentity: { authorName: "Ada Lovelace", authorEmail: "ada@example.com" },
  });
  await h.orch.run(DIR);
  await tick();
  expect(h.repairCalls).toHaveLength(1);
  expect(h.repairCalls[0]).toMatchObject({
    projectDir: DIR,
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
    logFile: "/logs/book.log",
  });
  // The repair ran behind the recovering → recovered statuses.
  expect(h.emitted.some((e) => e.state === "recovering")).toBe(true);
  expect(h.emitted.some((e) => e.state === "recovered")).toBe(true);
});

test("a corruption-looking throw routes to repairRepo; an ordinary throw does NOT", async () => {
  const corrupt = makeHarness({
    syncProject: () => {
      throw new Error("object not found abc123");
    },
    looksLikeCorruption: true,
  });
  await corrupt.orch.run(DIR);
  await tick();
  expect(corrupt.repairCalls).toHaveLength(1);

  const plain = makeHarness({
    syncProject: () => {
      throw new Error("some logic bug");
    },
  });
  await plain.orch.run(DIR);
  await tick();
  expect(plain.repairCalls).toHaveLength(0);
  expect(plain.emitted.some((e) => e.state === "error")).toBe(true);
});

test("a failed repair emits its author-language message; retry_later re-arms later", async () => {
  const failed = makeHarness({
    syncProject: () => {
      const e = new Error("needs repair");
      (e as Error & { code?: string }).code = "RepoNeedsRecovery";
      throw e;
    },
    repair: () => ({ status: "failed", message: "Files safe; repair could not finish.", actions: [] }),
  });
  await failed.orch.run(DIR);
  await tick();
  const errEmit = failed.emitted.find((e) => e.state === "error");
  expect(errEmit?.message).toBe("Files safe; repair could not finish.");
  // The single-flight slot is free again (a later trigger can run).
  expect(failed.orch.getState(DIR)?.inFlight).toBe(false);
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

// ── Error-outcome message plumbing (code-review) ─────────────────────────────
// A SyncOutcome "error" always carries an author-language `message` (e.g. the
// insecure-transport guidance from sync-messages.ts). Ambient auto-sync must
// forward it on the status emit — otherwise manual sync shows the guidance
// while auto-sync users only ever see a generic error pill.

const INSECURE_MSG =
  "This project's online address isn't secure, so the saved connection wasn't sent — connections are never sent over an insecure address. Switch the address to a secure one (starting with https) to sync.";

test("an 'error' outcome carries the outcome's plain-language message on the emit", async () => {
  const h = makeHarness({
    syncProject: () => ({ status: "error", message: INSECURE_MSG }),
  });
  await h.orch.run(DIR);
  await tick();

  const errEmit = h.emitted.find((e) => e.state === "error");
  expect(errEmit).toBeDefined();
  expect(errEmit?.message).toBe(INSECURE_MSG);
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

test("runPreflight: non-git source releases the lock without any git I/O", async () => {
  const h = makeHarness();
  await h.orch.runPreflight(DIR, { type: "local-folder", path: DIR });
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: healthy repo (classifyFromHealth → null) releases the lock without repairing", async () => {
  const h = makeHarness({ classifyFromHealth: () => null });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.repairCalls).toHaveLength(0);
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: skips entirely when the lock is already held", async () => {
  const h = makeHarness({ classifyFromHealth: () => "needs_repair" });
  expect(h.orch.acquire(DIR)).toBe(true); // hold the lock externally first
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.repairCalls).toHaveLength(0);
  expect(h.orch.acquire(DIR)).toBe(false); // still held — runPreflight never touched it
});

test("runPreflight: structural damage repairs behind recovering/recovered and releases the lock", async () => {
  const h = makeHarness({ classifyFromHealth: () => "needs_repair" });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.repairCalls).toHaveLength(1);
  expect(h.emitted.some((e) => e.state === "recovering")).toBe(true);
  expect(h.emitted.some((e) => e.state === "recovered")).toBe(true);
  expect(h.orch.acquire(DIR)).toBe(true); // lock was released
});

test("runPreflight: retry_later emits the repair message and re-arms run() after the delay", async () => {
  const h = makeHarness({
    classifyFromHealth: () => "needs_repair",
    repair: () => ({ status: "retry_later", message: "m", actions: [], retryAfterMs: 5 }),
    syncProject: () => ({ status: "synced" }),
  });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  const errEmit = h.emitted.find((e) => e.state === "error");
  expect(errEmit?.message).toBe("m");
  // The retry timer re-arms run() after retryAfterMs (guarded by getWatchedDir).
  await waitFor(() => h.syncCalls.length > 0);
  expect(h.syncCalls).toEqual([DIR]);
});

test("runPreflight: a failed repair emits error and leaves the lock free", async () => {
  const h = makeHarness({
    classifyFromHealth: () => "needs_repair",
    repair: () => ({ status: "failed", message: "Files safe.", actions: [] }),
  });
  await h.orch.runPreflight(DIR, LOCAL_GIT_SOURCE);
  expect(h.emitted.some((e) => e.state === "error")).toBe(true);
  expect(h.orch.acquire(DIR)).toBe(true);
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

// ── 2026-07-29 audit: the operation log identifies the REPO, not the book ─────
//
// A sync is a whole-repository operation (R9), so its log is the repository's
// log. Keying it on `path.basename(dir)` — the opened BOOK — split one repo's
// sync history across a file per book and made two same-named books in
// different repos interleave into one file, against recovery-paths.ts's own
// "one file per project so logs from different projects don't interleave".

test("run() logs a nested book's sync under the REPO's slug, not the book's", async () => {
  const h = makeHarness({ repoRoot: "/repo", subPath: "books/field-guide" });
  await h.orch.run(DIR);
  await tick();
  expect(h.syncArgs.length).toBe(1);
  expect((h.syncArgs[0] as { logFile?: string }).logFile).toBe("/logs/repo.log");
});

test("run() keeps the project's own slug when the book IS the repo root", async () => {
  const h = makeHarness({ repoRoot: DIR, subPath: "" });
  await h.orch.run(DIR);
  await tick();
  expect((h.syncArgs[0] as { logFile?: string }).logFile).toBe("/logs/book.log");
});
