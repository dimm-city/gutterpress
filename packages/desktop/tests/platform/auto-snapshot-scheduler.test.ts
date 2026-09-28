import { expect, test } from "bun:test";
import {
  AutoSnapshotScheduler,
  AUTO_SNAPSHOT_FAILURE_THRESHOLD,
  type AutoSnapshotDeps,
} from "../../electron/auto-snapshot/scheduler";

type LibModule = typeof import("gutterpress");

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
  /** Called per provider.snapshot(); may throw/reject to exercise error paths. */
  snapshot?: (args: unknown) => unknown;
  isNoChangesError?: (e: unknown) => boolean;
  /** Injected onSnapshotFailed dep (M39 failure-threshold signal). */
  onSnapshotFailed?: (dir: string, consecutiveFailures: number, error: unknown) => void;
  /** The `gitIdentity` settings slice the scheduler must honour. */
  gitIdentity?: { authorName?: string; authorEmail?: string };
  /** The repo root the fake classification reports (a nested book's enclosing repo). */
  repoRoot?: string;
  /** The book's path relative to `repoRoot` ("" when the book IS the repo root). */
  subPath?: string;
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
    repoRootForSource: (source: { type?: string; repoRoot?: string }, fallbackDir: string) =>
      source?.type === "local-git-folder" ? source.repoRoot || fallbackDir : fallbackDir,
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
    readSettings: async () => ({
      versionHistory: {},
      ...(opts.gitIdentity ? { gitIdentity: opts.gitIdentity } : {}),
    }),
    getWatchedDir: () => watched,
    operationLogPath: (slug: string) => `/logs/${slug}.log`,
    setTimer: clock.set,
    clearTimer: clock.clear,
    onPendingChanged: (d) => pendingChanges.push(d),
    ...(opts.onSnapshotFailed ? { onSnapshotFailed: opts.onSnapshotFailed } : {}),
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

// ── Configured commit identity ────────────────────────────────────────────────
//
// The automatic snapshot must be committed as the author, exactly like the
// manual "Save a version" path (which goes through gitIdentityArgs() in
// electron/api/git-identity-args.ts, SFE-P5c3). Before this was wired, run() called
// provider.snapshot() with no author fields at all, so every automatic snapshot
// was silently attributed to the lib's "Gutterpress <noreply@Gutterpress.local>"
// default while manual saves carried the configured name/email.

test("(c2) run() commits the automatic snapshot with the configured name + email", async () => {
  const h = makeHarness({
    gitIdentity: { authorName: "Ada Lovelace", authorEmail: "ada@example.com" },
  });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls[0]).toEqual({
    projectDir: DIR,
    message: AUTO_SNAPSHOT_MESSAGE,
    logFile: "/logs/book.log",
    authorName: "Ada Lovelace",
    authorEmail: "ada@example.com",
  });
});

test("(c2) blank/whitespace identity fields are omitted, not sent as empty strings", async () => {
  // Empty means "use the existing repo config, then the Gutterpress default" —
  // passing "" would override that fallback with a blank author.
  const h = makeHarness({ gitIdentity: { authorName: "  ", authorEmail: "" } });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls[0]).toEqual({
    projectDir: DIR,
    message: AUTO_SNAPSHOT_MESSAGE,
    logFile: "/logs/book.log",
  });
});

test("(c2) a partially configured identity passes only the filled-in field", async () => {
  const h = makeHarness({ gitIdentity: { authorEmail: "ada@example.com" } });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls[0]).toEqual({
    projectDir: DIR,
    message: AUTO_SNAPSHOT_MESSAGE,
    logFile: "/logs/book.log",
    authorEmail: "ada@example.com",
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

// ── onSnapshotFailed threshold signal (M39 — UX critical review) ────────────────
//
// AutoSnapshotScheduler.run's catch used to only console.error and return — a
// persistently failing safety net gave zero signal. onSnapshotFailed fires once
// consecutive failures for the SAME dir reach AUTO_SNAPSHOT_FAILURE_THRESHOLD,
// and again every subsequent multiple of the threshold (so a long-running
// failure keeps re-signalling instead of going silent forever). A success, or a
// clean-tree ("no changes") outcome, resets the streak.

test("(k) onSnapshotFailed does NOT fire before the failure threshold is reached", async () => {
  const failed: [string, number, unknown][] = [];
  const h = makeHarness({
    snapshot: () => {
      throw new Error("disk full");
    },
    onSnapshotFailed: (dir, n, e) => failed.push([dir, n, e]),
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD - 1; i++) {
    await h.sched.run(DIR);
  }
  expect(failed.length).toBe(0);
});

test("(k) onSnapshotFailed fires exactly once when consecutive failures reach the threshold", async () => {
  const failed: [string, number, unknown][] = [];
  const boom = new Error("disk full");
  const h = makeHarness({
    snapshot: () => {
      throw boom;
    },
    onSnapshotFailed: (dir, n, e) => failed.push([dir, n, e]),
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD; i++) {
    await h.sched.run(DIR);
  }
  expect(failed).toEqual([[DIR, AUTO_SNAPSHOT_FAILURE_THRESHOLD, boom]]);
});

test("(k) onSnapshotFailed fires again on every subsequent multiple of the threshold", async () => {
  const failed: [string, number, unknown][] = [];
  const h = makeHarness({
    snapshot: () => {
      throw new Error("disk full");
    },
    onSnapshotFailed: (dir, n) => failed.push([dir, n, undefined]),
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD * 2; i++) {
    await h.sched.run(DIR);
  }
  expect(failed.map((f) => f[1])).toEqual([
    AUTO_SNAPSHOT_FAILURE_THRESHOLD,
    AUTO_SNAPSHOT_FAILURE_THRESHOLD * 2,
  ]);
});

test("(l) a successful run resets the consecutive-failure streak", async () => {
  const failed: [string, number, unknown][] = [];
  let shouldFail = true;
  const h = makeHarness({
    snapshot: () => {
      if (shouldFail) throw new Error("disk full");
      return { ok: true };
    },
    onSnapshotFailed: (dir, n) => failed.push([dir, n, undefined]),
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD - 1; i++) {
    await h.sched.run(DIR);
  }
  expect(failed.length).toBe(0);
  shouldFail = false;
  await h.sched.run(DIR); // success — resets the streak
  shouldFail = true;
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD - 1; i++) {
    await h.sched.run(DIR);
  }
  // Only (threshold - 1) failures accrued since the reset — still below threshold.
  expect(failed.length).toBe(0);
});

test("(m) a clean tree (isNoChangesError) is not counted as a failure and resets the streak", async () => {
  const failed: [string, number, unknown][] = [];
  const clean = new Error("nothing to commit");
  let raiseClean = false;
  const h = makeHarness({
    snapshot: () => {
      throw raiseClean ? clean : new Error("disk full");
    },
    isNoChangesError: (e) => e === clean,
    onSnapshotFailed: (dir, n) => failed.push([dir, n, undefined]),
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD - 1; i++) {
    await h.sched.run(DIR);
  }
  expect(failed.length).toBe(0);
  raiseClean = true;
  await h.sched.run(DIR); // clean tree — resets the streak, not a failure
  raiseClean = false;
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD - 1; i++) {
    await h.sched.run(DIR);
  }
  expect(failed.length).toBe(0);
});

test("(n) onSnapshotFailed is optional — a missing dep never throws from run()", async () => {
  const h = makeHarness({
    snapshot: () => {
      throw new Error("disk full");
    },
  });
  for (let i = 0; i < AUTO_SNAPSHOT_FAILURE_THRESHOLD + 1; i++) {
    await expect(h.sched.run(DIR)).resolves.toBeUndefined();
  }
});

// ── 2026-07-29 audit: the operation log identifies the REPO, not the book ─────
//
// The log filename was keyed on `path.basename(dir)` — the OPENED BOOK. In a
// multi-book repo that fragments one repository's sync/snapshot history across
// a file per book, and two same-named books in different repos interleave into
// one file — against recovery-paths.ts's own "one file per project so logs from
// different projects don't interleave", and divergent from the lib's
// buildRecoveryContext, which slugs `path.basename(repoDir)`.
//
// A snapshot is a whole-repo operation (R9), so its log is the repo's log.

test("run() logs a nested book's snapshot under the REPO's slug, not the book's", async () => {
  const h = makeHarness({ repoRoot: "/repo", subPath: "books/field-guide" });
  await h.sched.run("/repo/books/field-guide");
  await settle();
  expect(h.snapshotCalls.length).toBe(1);
  expect(h.snapshotCalls[0]).toEqual({
    projectDir: "/repo/books/field-guide",
    message: AUTO_SNAPSHOT_MESSAGE,
    logFile: "/logs/repo.log",
  });
});

test("run() still uses the project's own slug when the book IS the repo root", async () => {
  const h = makeHarness({ repoRoot: DIR, subPath: "" });
  await h.sched.run(DIR);
  await settle();
  expect(h.snapshotCalls[0]).toMatchObject({ logFile: "/logs/book.log" });
});
