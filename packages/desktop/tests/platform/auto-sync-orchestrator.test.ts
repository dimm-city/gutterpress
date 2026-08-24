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
  /** When set, diagnoseProjectRemote rejects with this — to exercise the
   *  probe-failure path in run() (code-review: must release the lock). */
  diagnoseThrows?: Error;
  /** The `gitIdentity` settings slice the orchestrator must honour. */
  gitIdentity?: { authorName?: string; authorEmail?: string };
}

function makeHarness(opts: FakeLibOptions = {}): Harness {
  const emitted: SyncStatusPayload[] = [];
  const syncCalls: string[] = [];
  const syncArgs: unknown[] = [];
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
    resolveLogger: () => ({ info: () => {}, error: () => {} }),
    AUTO_SYNC_PUSH_INTERVAL_MINUTES: 15,
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

test("an 'up-to-date' outcome emits the same 'synced' state as a sending sync", async () => {
  // The pill draws both identically ("Everything is in sync"), so there is
  // ONE wire state. The lib's SyncOutcome still distinguishes them — that is
  // what the manual-sync toast reads.
  const h = makeHarness({
    syncProject: () => ({ status: "up-to-date", filesChanged: true }),
  });
  await h.orch.run(DIR);
  await tick();

  expect(h.emitted.map((e) => e.state)).toEqual(["syncing", "synced"]);
  expect(h.emitted[1]?.filesChanged).toBe(true);
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
// These exist so a caller OUTSIDE run() can hold the exact same lock across a
// multi-step async flow without reaching into the state bag.

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

test("scheduleInitialSync never holds the single-flight lock", () => {
  // The repair preflight this replaced HELD the lock across its whole async
  // flow. Arming the initial sync must not: the deferred run() acquires it
  // for itself when it fires.
  const h = makeHarness();
  h.orch.scheduleInitialSync(DIR);
  expect(h.orch.acquire(DIR)).toBe(true);
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

// ── Push cadence (owner decision 2026-08-23) ─────────────────────────────────
//
// Every tick pulls; only a tick whose 15-minute push window has elapsed also
// pushes. The FIRST tick of a session pushes — that is what delivers work a
// previous session's exit pass could not send — and a COMPLETED push-enabled
// pass ("synced" or "up-to-date") resets the window. Failures leave it armed
// so the next 2-minute tick retries the push.

const pushFlagOf = (h: Harness, i: number): boolean | undefined =>
  (h.syncArgs[i] as { push?: boolean } | undefined)?.push;

test("ticks pull-only between push windows; an elapsed window re-enables the push", async () => {
  const T0 = 1_700_000_000_000;
  const h = makeHarness();
  h.setClock(T0);
  await h.orch.run(DIR); // first tick of the session: push
  h.setClock(T0 + 2 * 60_000);
  await h.orch.run(DIR); // 2 minutes later: pull-merge-only
  h.setClock(T0 + 15 * 60_000);
  await h.orch.run(DIR); // window elapsed: push again
  h.setClock(T0 + 17 * 60_000);
  await h.orch.run(DIR); // 2 minutes after that push: pull-only again
  expect([0, 1, 2, 3].map((i) => pushFlagOf(h, i))).toEqual([true, false, true, false]);
});

test("an up-to-date push-due pass also resets the push window (nothing to send = in sync)", async () => {
  const T0 = 1_700_000_000_000;
  const h = makeHarness({ syncProject: () => ({ status: "up-to-date" }) });
  h.setClock(T0);
  await h.orch.run(DIR);
  h.setClock(T0 + 2 * 60_000);
  await h.orch.run(DIR);
  expect([pushFlagOf(h, 0), pushFlagOf(h, 1)]).toEqual([true, false]);
});

test("a failed push-due pass leaves the push window armed — the next tick retries the push", async () => {
  const T0 = 1_700_000_000_000;
  const h = makeHarness({
    syncProject: () => ({ status: "offline", message: "You're offline right now." }),
  });
  h.setClock(T0);
  await h.orch.run(DIR); // push-due, fails
  h.setClock(T0 + 2 * 60_000);
  await h.orch.run(DIR); // still push-due — not silenced for 15 minutes
  expect([pushFlagOf(h, 0), pushFlagOf(h, 1)]).toEqual([true, true]);
});

test("a pull-only pass that combined files forwards the converge report on its emit", async () => {
  const h = makeHarness({
    syncProject: () => ({
      status: "up-to-date",
      filesChanged: true,
      combinedFiles: ["chapter-01.md"],
      keptBothFiles: [{ path: "cover.png", onlinePath: "cover.online.png" }],
    }),
  });
  await h.orch.run(DIR);
  await tick();
  const done = h.emitted.find((e) => e.state === "synced");
  expect(done?.combinedFiles).toEqual(["chapter-01.md"]);
  expect(done?.keptBothFiles).toEqual([{ path: "cover.png", onlinePath: "cover.online.png" }]);
});

// ── The exit pass (project close / app quit) ─────────────────────────────────
//
// One final push-enabled syncProject at the existing onStop flush point,
// BOUNDED — an app that hangs on quit because the network dropped is worse
// than an unpushed change (the next launch's first tick pushes it instead).

test("runExitPush runs one final push-enabled sync and resets the push window", async () => {
  const T0 = 1_700_000_000_000;
  const h = makeHarness();
  h.setClock(T0);
  await h.orch.runExitPush(DIR);
  expect(h.syncCalls.length).toBe(1);
  expect(pushFlagOf(h, 0)).toBe(true);
  // The window was reset: reopening within it starts with a pull-only tick.
  h.setClock(T0 + 2 * 60_000);
  await h.orch.run(DIR);
  expect(pushFlagOf(h, 1)).toBe(false);
});

test("runExitPush skips while a tick is in flight (single-flight, never overlap)", async () => {
  let releaseFirst!: () => void;
  let firstCalledResolve!: () => void;
  const firstCalled = new Promise<void>((r) => (firstCalledResolve = r));
  const h = makeHarness({
    syncProject: () =>
      new Promise((res) => {
        firstCalledResolve();
        releaseFirst = () => res({ status: "synced" });
      }),
  });
  const p1 = h.orch.run(DIR);
  await firstCalled;
  await h.orch.runExitPush(DIR); // must skip — never a second concurrent sync
  expect(h.syncCalls.length).toBe(1);
  releaseFirst();
  await p1;
});

test("runExitPush is BOUNDED: a hung network cannot hang quit, and the slot is released", async () => {
  let calls = 0;
  const h = makeHarness({
    syncProject: () => {
      calls++;
      // Only the exit pass hangs; a later tick behaves normally.
      return calls === 1 ? new Promise(() => {}) : { status: "synced" };
    },
  });
  const started = performance.now();
  await h.orch.runExitPush(DIR, 50);
  expect(performance.now() - started).toBeLessThan(1_500);
  // The single-flight slot is free again despite the hung sync…
  expect(h.orch.getState(DIR)?.inFlight ?? false).toBe(false);
  // …and the timed-out send left the push window ARMED: the next session's
  // first tick pushes the work this pass could not.
  await h.orch.run(DIR);
  expect(pushFlagOf(h, 1)).toBe(true);
});

test("runExitPush does nothing when the project cannot sync", async () => {
  const h = makeHarness({ canSync: false });
  await h.orch.runExitPush(DIR);
  expect(h.syncCalls.length).toBe(0);
});

test("a failed exit push re-arms the push for the next session's first tick", async () => {
  const T0 = 1_700_000_000_000;
  let calls = 0;
  const h = makeHarness({
    syncProject: () => {
      calls++;
      return calls === 2
        ? { status: "offline", message: "You're offline right now." }
        : { status: "synced" };
    },
  });
  h.setClock(T0);
  await h.orch.run(DIR); // successful push — window reset
  h.setClock(T0 + 60_000);
  await h.orch.runExitPush(DIR); // exit push fails (offline)
  h.setClock(T0 + 2 * 60_000);
  await h.orch.run(DIR); // "reopen": first tick pushes again, not in 13 minutes
  expect([pushFlagOf(h, 0), pushFlagOf(h, 1), pushFlagOf(h, 2)]).toEqual([true, true, true]);
});
