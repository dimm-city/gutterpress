import { expect, test } from "bun:test";
import {
  AutoSnapshotScheduler,
  type AutoSnapshotDeps,
} from "../../electron/auto-snapshot/scheduler";

type LibModule = typeof import("@dimm-city/print-md");

const DIR = "/book";
const AUTO_SNAPSHOT_MESSAGE = "chore: auto snapshot";

/** Wait for pending microtasks (the async arm bodies) to settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));
/** A few ticks to be safe across the awaits inside schedule()/run(). */
async function settle() {
  for (let i = 0; i < 4; i++) await tick();
}

interface FakeTimer {
  id: number;
  cb: () => void;
  ms: number;
}

/** Injectable fake timer manager so tests control when the debounce fires. */
class FakeClock {
  timers = new Map<number, FakeTimer>();
  private nextId = 1;
  set = (cb: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.set(id, { id, cb, ms });
    return id;
  };
  clear = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  /** Fire the single armed timer (the scheduler only ever holds one). */
  fireOnly(): void {
    const only = [...this.timers.values()][0];
    if (!only) throw new Error("no timer armed");
    this.timers.delete(only.id);
    only.cb();
  }
  get armedMs(): number | null {
    const only = [...this.timers.values()][0];
    return only ? only.ms : null;
  }
  get size(): number {
    return this.timers.size;
  }
}

interface FakeLibOptions {
  autoSnapshotDelayMs?: number | null;
  sourceType?: string;
  subPath?: string;
  repoRoot?: string;
  /** Called per provider.snapshot(); may throw/reject to exercise error paths. */
  snapshot?: (args: unknown) => unknown;
  isNoChangesError?: (e: unknown) => boolean;
}

interface Harness {
  sched: AutoSnapshotScheduler;
  clock: FakeClock;
  /** Args of every provider.snapshot() call, in order. */
  snapshotCalls: unknown[];
  /** Every value passed to onPendingChanged, in order. */
  pendingChanges: (string | null)[];
  /** Mutable watched dir the stale-dir guard reads. */
  setWatchedDir: (d: string | null) => void;
  /** Mutate the live delay to prove schedule() re-reads it. */
  setDelay: (ms: number | null) => void;
}

function makeHarness(opts: FakeLibOptions = {}): Harness {
  const clock = new FakeClock();
  const snapshotCalls: unknown[] = [];
  const pendingChanges: (string | null)[] = [];
  let watched: string | null = DIR;
  let delay: number | null =
    opts.autoSnapshotDelayMs === undefined ? 600_000 : opts.autoSnapshotDelayMs;

  const lib = {
    AUTO_SNAPSHOT_MESSAGE,
    autoSnapshotDelayMs: () => delay,
    detectProjectSource: async () => ({
      type: opts.sourceType ?? "local-git-folder",
      subPath: opts.subPath ?? "",
      repoRoot: opts.repoRoot ?? DIR,
    }),
    providerFor: () => ({
      snapshot: async (args: unknown) => {
        snapshotCalls.push(args);
        if (opts.snapshot) return opts.snapshot(args);
        return { ok: true };
      },
    }),
    isNoChangesError: (e: unknown) =>
      opts.isNoChangesError ? opts.isNoChangesError(e) : false,
  } as unknown as LibModule;

  const deps: AutoSnapshotDeps = {
    loadLib: async () => lib,
    readSettings: async () => ({ versionHistory: {} }),
    getWatchedDir: () => watched,
    operationLogPath: (slug: string) => `/logs/${slug}.log`,
    setTimer: clock.set,
    clearTimer: clock.clear,
    onPendingChanged: (d) => pendingChanges.push(d),
  };

  return {
    sched: new AutoSnapshotScheduler(deps),
    clock,
    snapshotCalls,
    pendingChanges,
    setWatchedDir: (d) => {
      watched = d;
    },
    setDelay: (ms) => {
      delay = ms;
    },
  };
}

// ── run() guards ──────────────────────────────────────────────────────────────

test("(a) run() does not snapshot a non local-git-folder project", async () => {
  const h = makeHarness({ sourceType: "local-folder" });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls.length).toBe(0);
});

test("(b) run() skips a folder nested inside an enclosing repo (subPath set)", async () => {
  const h = makeHarness({ subPath: "chapters", repoRoot: "/repo" });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls.length).toBe(0);
});

test("(c) run() snapshots with message + log path derived from basename", async () => {
  const h = makeHarness();
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls.length).toBe(1);
  expect(h.snapshotCalls[0]).toEqual({
    projectDir: DIR,
    message: AUTO_SNAPSHOT_MESSAGE,
    logFile: "/logs/book.log",
  });
});

test("(d) run() swallows an isNoChangesError rejection without throwing", async () => {
  const clean = new Error("nothing to commit");
  const h = makeHarness({
    snapshot: () => {
      throw clean;
    },
    isNoChangesError: (e) => e === clean,
  });
  // Must resolve, not reject.
  await expect(h.sched.run(DIR)).resolves.toBeUndefined();
});

test("(d) run() swallows a real snapshot error too (logs, never throws)", async () => {
  const h = makeHarness({
    snapshot: () => {
      throw new Error("disk full");
    },
    isNoChangesError: () => false,
  });
  await expect(h.sched.run(DIR)).resolves.toBeUndefined();
});

// ── schedule() debounce arming ──────────────────────────────────────────────────

test("(e) schedule() arms a timer at the LIVE delay when enabled", async () => {
  const h = makeHarness({ autoSnapshotDelayMs: 12_345 });
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(true);
  expect(h.clock.armedMs).toBe(12_345);
  // Live re-read: change the delay, re-arm, and the new value is used.
  h.setDelay(999);
  h.sched.schedule(DIR);
  await settle();
  expect(h.clock.armedMs).toBe(999);
  expect(h.clock.size).toBe(1); // old timer cancelled, not stacked
});

test("(e) schedule() does NOT arm when auto-snapshot is disabled (delay null)", async () => {
  const h = makeHarness({ autoSnapshotDelayMs: null });
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(false);
  expect(h.clock.size).toBe(0);
});

test("(f) schedule() does NOT arm when the watched dir changed during the awaits", async () => {
  const h = makeHarness();
  h.setWatchedDir("/other"); // getWatchedDir() !== dir after the awaits
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(false);
  expect(h.clock.size).toBe(0);
});

test("(g) firing the debounce clears pending and runs the snapshot", async () => {
  const h = makeHarness();
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(true);
  h.clock.fireOnly();
  await settle();
  expect(h.sched.hasPending()).toBe(false);
  // onPendingChanged(null) recorded on fire.
  expect(h.pendingChanges[h.pendingChanges.length - 1]).toBeNull();
  // And run(dir) executed the snapshot.
  expect(h.snapshotCalls.length).toBe(1);
});

// ── flush() ─────────────────────────────────────────────────────────────────────

test("(h) flush() runs the pending snapshot, clears pending, returns a promise", async () => {
  const h = makeHarness();
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(true);
  const p = h.sched.flush();
  expect(p).toBeInstanceOf(Promise);
  await p;
  await settle();
  expect(h.sched.hasPending()).toBe(false);
  expect(h.snapshotCalls.length).toBe(1);
});

test("(h) flush() returns undefined when nothing is pending", () => {
  const h = makeHarness();
  expect(h.sched.flush()).toBeUndefined();
});

// ── cancel() ────────────────────────────────────────────────────────────────────

test("(i) cancel() clears the timer and pending without running", async () => {
  const h = makeHarness();
  h.sched.schedule(DIR);
  await settle();
  expect(h.sched.hasPending()).toBe(true);
  h.sched.cancel();
  expect(h.sched.hasPending()).toBe(false);
  expect(h.clock.size).toBe(0);
  await settle();
  expect(h.snapshotCalls.length).toBe(0);
});

// ── onPendingChanged mirror signal ───────────────────────────────────────────────

test("(j) onPendingChanged fires dir on arm and null on clear", async () => {
  const h = makeHarness();
  h.sched.schedule(DIR);
  await settle();
  expect(h.pendingChanges).toContain(DIR);
  h.sched.cancel();
  expect(h.pendingChanges[h.pendingChanges.length - 1]).toBeNull();
});
