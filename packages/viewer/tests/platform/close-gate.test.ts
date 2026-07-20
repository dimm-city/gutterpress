import { expect, test } from "bun:test";
import {
  runCloseGate,
  SNAPSHOT_BACKSTOP_MS,
  type CloseGateDeps,
} from "../../electron/close-gate";

/** Wait for pending microtasks (the async gate body) to settle. */
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() {
  for (let i = 0; i < 4; i++) await tick();
}

interface FakeTimer {
  id: number;
  at: number;
  cb: () => void;
  ms: number;
}

/** Injectable virtual clock so tests control when watchdogs fire. */
class FakeClock {
  now = 0;
  timers = new Map<number, FakeTimer>();
  private nextId = 1;
  set = (cb: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.set(id, { id, at: this.now + ms, cb, ms });
    return id;
  };
  clear = (h: unknown): void => {
    this.timers.delete(h as number);
  };
  /** Advance virtual time, firing due timers in deadline order. */
  async advance(ms: number): Promise<void> {
    this.now += ms;
    for (;;) {
      const due = [...this.timers.values()]
        .filter((t) => t.at <= this.now)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers.delete(due.id);
      due.cb();
      await settle();
    }
    await settle();
  }
  get armedMs(): number[] {
    return [...this.timers.values()].map((t) => t.ms);
  }
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HarnessOpts {
  /** Return value of deps.snapshot(); default is a deferred promise. */
  snapshot?: () => Promise<void> | undefined;
}

function makeHarness(opts: HarnessOpts = {}) {
  const clock = new FakeClock();
  const flush = deferred<boolean>();
  const snap = deferred<void>();
  let snapshotCalls = 0;
  let finishCalls = 0;
  const deps: CloseGateDeps = {
    flush: () => flush.promise,
    snapshot: () => {
      snapshotCalls++;
      return opts.snapshot ? opts.snapshot() : snap.promise;
    },
    finish: () => {
      finishCalls++;
    },
    setTimer: clock.set,
    clearTimer: clock.clear,
  };
  runCloseGate(deps);
  return {
    clock,
    flush,
    snap,
    get snapshotCalls() {
      return snapshotCalls;
    },
    get finishCalls() {
      return finishCalls;
    },
  };
}

// R25 (the two-racing-timers bug): the old shape armed an outer 5s destroy
// watchdog at the same instant as the flush's own 5s watchdog and never
// cancelled it when the flush settled — a renderer replying just under the
// budget let the snapshot commit START and then the outer watchdog destroyed
// the window ~200ms later, mid-git-object-write (stale index.lock on next
// launch). A STARTED commit must be allowed to finish.
test("late flush reply + in-flight snapshot: finish waits for the commit (no racing destroy timer)", async () => {
  const h = makeHarness();
  // No destroy watchdog races the flush phase — the flush owns its own budget.
  expect(h.clock.armedMs).toEqual([]);
  // Renderer replies just under the flush budget; snapshot commit starts.
  await h.clock.advance(4800);
  h.flush.resolve(true);
  await settle();
  expect(h.snapshotCalls).toBe(1);
  // Past the old 5s mark while the commit is still running: must NOT destroy.
  await h.clock.advance(400);
  expect(h.finishCalls).toBe(0);
  // Commit settles → finish exactly once, backstop cleared.
  h.snap.resolve();
  await settle();
  expect(h.finishCalls).toBe(1);
  expect(h.clock.armedMs).toEqual([]);
});

test("hung renderer (flush watchdog fired): snapshot is skipped, gate finishes", async () => {
  const h = makeHarness();
  // requestRendererFlush's own watchdog resolves false at its budget.
  await h.clock.advance(5000);
  h.flush.resolve(false);
  await settle();
  // DELIBERATE POLICY: never start a git commit for a hung renderer.
  expect(h.snapshotCalls).toBe(0);
  expect(h.finishCalls).toBe(1);
});

test("hung snapshot commit: the named backstop (armed at commit start) fires finish", async () => {
  const h = makeHarness({ snapshot: () => new Promise<never>(() => {}) });
  h.flush.resolve(true);
  await settle();
  // Backstop armed only once the commit started, with its own generous budget.
  expect(h.clock.armedMs).toEqual([SNAPSHOT_BACKSTOP_MS]);
  // The old whole-gate 5s watchdog must not kill the started commit early.
  await h.clock.advance(5000);
  expect(h.finishCalls).toBe(0);
  await h.clock.advance(SNAPSHOT_BACKSTOP_MS - 5000);
  expect(h.finishCalls).toBe(1);
});

test("nothing pending to snapshot: finish immediately after the flush settles", async () => {
  const h = makeHarness({ snapshot: () => undefined });
  h.flush.resolve(true);
  await settle();
  expect(h.snapshotCalls).toBe(1);
  expect(h.finishCalls).toBe(1);
  expect(h.clock.armedMs).toEqual([]);
});

test("rejected snapshot promise still finishes exactly once and clears the backstop", async () => {
  const h = makeHarness();
  h.flush.resolve(true);
  await settle();
  h.snap.reject(new Error("commit failed"));
  await settle();
  expect(h.finishCalls).toBe(1);
  expect(h.clock.armedMs).toEqual([]);
});
