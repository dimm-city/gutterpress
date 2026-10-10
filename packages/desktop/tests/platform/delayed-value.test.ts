import { expect, test } from "bun:test";
import { DelayedValue, INDICATOR_TIMING, type Clock } from "../../src/lib/loading/delayed-value";

/** A manual clock: time only moves when the test says so. */
function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (handle) => void timers.delete(handle as number),
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
    }
    now = target;
  };
  return { clock, advance, pending: () => timers.size };
}

function harness(timing = INDICATOR_TIMING) {
  const c = makeClock();
  const seen: Array<string | null> = [];
  const value = new DelayedValue<string>((v) => seen.push(v), timing, c.clock);
  return { value, seen, ...c };
}

const { delayMs, minVisibleMs } = INDICATOR_TIMING;

test("work that ends before the delay never shows anything", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs - 1);
  expect(h.seen).toEqual([]);
  h.value.set(null);
  h.advance(5000);
  expect(h.seen).toEqual([]);
  expect(h.pending()).toBe(0);
});

test("work that outlasts the delay shows once the delay has passed", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs);
  expect(h.seen).toEqual(["opening"]);
});

test("the reveal shows the freshest value fed while waiting, not the first", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs / 2);
  h.value.set("downloading");
  h.advance(delayMs / 2);
  expect(h.seen).toEqual(["downloading"]);
});

test("while visible a new value replaces the shown one immediately", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs);
  h.value.set("layout");
  expect(h.seen).toEqual(["opening", "layout"]);
});

test("once shown it stays for the minimum time even if the work ends at once", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs);
  h.value.set(null);
  h.advance(minVisibleMs - 1);
  expect(h.seen).toEqual(["opening"]);
  h.advance(1);
  expect(h.seen).toEqual(["opening", null]);
});

test("work that ends after the minimum time hides immediately", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs + minVisibleMs + 10);
  h.value.set(null);
  expect(h.seen).toEqual(["opening", null]);
});

test("the last value stays up while the hide is pending", () => {
  const h = harness();
  h.value.set("layout");
  h.advance(delayMs);
  h.value.set(null);
  h.advance(minVisibleMs / 2);
  // No blank frame in between: nothing was emitted but the original value.
  expect(h.seen).toEqual(["layout"]);
});

test("work resuming during the hold cancels the hide (no strobe)", () => {
  const h = harness();
  h.value.set("opening");
  h.advance(delayMs);
  h.value.set(null);
  h.advance(100);
  h.value.set("layout");
  h.advance(minVisibleMs * 4);
  expect(h.seen).toEqual(["opening", "layout"]);
});

test("a second burst of work gets its own delay", () => {
  const h = harness();
  h.value.set("a");
  h.advance(delayMs + minVisibleMs);
  h.value.set(null);
  expect(h.seen).toEqual(["a", null]);
  h.value.set("b");
  h.advance(delayMs - 1);
  expect(h.seen).toEqual(["a", null]);
  h.advance(1);
  expect(h.seen).toEqual(["a", null, "b"]);
});

test("dispose cancels pending timers and emits nothing further", () => {
  const h = harness();
  h.value.set("opening");
  h.value.dispose();
  h.advance(10_000);
  expect(h.seen).toEqual([]);
  expect(h.pending()).toBe(0);
});

test("one timing pair for every indicator sits in the 150-250ms / half-second range", () => {
  expect(delayMs).toBeGreaterThanOrEqual(150);
  expect(delayMs).toBeLessThanOrEqual(250);
  expect(minVisibleMs).toBeGreaterThanOrEqual(400);
});
