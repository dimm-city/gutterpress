import { test, expect } from "bun:test";
import type { Page } from "puppeteer-core";
import {
  evaluatePaginationLiveness,
  paginateAndCapture,
  type PaginationLivenessState,
} from "./pagination.ts";
import { BuildError } from "./build-error.ts";

/**
 * Unit tests for the pure stall-detection decision (finding #19): given a
 * `.pagedjs_page` count poll and the previously tracked state, decide whether
 * pagination has stalled (the count has not advanced for at least
 * `stallWindowMs`). Extracted from the real polling loop (which needs a live
 * puppeteer `page`) so the decision logic itself is testable with a fake
 * page-count source — no browser required.
 */

const STALL_WINDOW_MS = 60_000;

test("does not flag a stall while the count keeps advancing", () => {
  let state: PaginationLivenessState = { count: 0, lastAdvanceAt: 0 };

  const polls = [
    { count: 1, at: 10_000 },
    { count: 4, at: 20_000 },
    { count: 10, at: 30_000 },
    { count: 25, at: 90_000 }, // a big jump after a while — still advancing
  ];

  for (const poll of polls) {
    const result = evaluatePaginationLiveness(
      poll.count,
      poll.at,
      state,
      STALL_WINDOW_MS
    );
    expect(result.stalled).toBe(false);
    // Advancing resets the liveness clock to the poll that advanced.
    expect(result.state).toEqual({ count: poll.count, lastAdvanceAt: poll.at });
    state = result.state;
  }
});

test("does not flag a stall before the sustained window has elapsed", () => {
  const state: PaginationLivenessState = { count: 5, lastAdvanceAt: 0 };

  // Same count, but well within the stall window since the last advance.
  const result = evaluatePaginationLiveness(5, 59_999, state, STALL_WINDOW_MS);

  expect(result.stalled).toBe(false);
  // lastAdvanceAt is untouched — the count did not advance.
  expect(result.state).toEqual({ count: 5, lastAdvanceAt: 0 });
});

test("flags a stall once the count has not advanced for the full window", () => {
  const state: PaginationLivenessState = { count: 5, lastAdvanceAt: 0 };

  const result = evaluatePaginationLiveness(5, 60_000, state, STALL_WINDOW_MS);

  expect(result.stalled).toBe(true);
  expect(result.state.count).toBe(5);
});

test("a real stall reproduces across repeated flat polls, not just one", () => {
  let state: PaginationLivenessState = { count: 3, lastAdvanceAt: 0 };
  const flatPolls = [10_000, 20_000, 30_000, 40_000, 50_000, 61_000];
  const results = flatPolls.map((at) => {
    const r = evaluatePaginationLiveness(3, at, state, STALL_WINDOW_MS);
    state = r.state;
    return r.stalled;
  });
  // Not stalled until 60s of no advance has elapsed; stalled from then on.
  expect(results).toEqual([false, false, false, false, false, true]);
});

test("a late advance after near-stall resets the window (no false positive)", () => {
  let state: PaginationLivenessState = { count: 3, lastAdvanceAt: 0 };

  // Almost stalled...
  let result = evaluatePaginationLiveness(3, 55_000, state, STALL_WINDOW_MS);
  expect(result.stalled).toBe(false);
  state = result.state;

  // ...but a new page appears just in time, resetting the clock.
  result = evaluatePaginationLiveness(4, 58_000, state, STALL_WINDOW_MS);
  expect(result.stalled).toBe(false);
  state = result.state;
  expect(state.lastAdvanceAt).toBe(58_000);

  // Now it takes a full fresh window from 58_000 to actually stall.
  result = evaluatePaginationLiveness(4, 100_000, state, STALL_WINDOW_MS);
  expect(result.stalled).toBe(false); // only 42s since the 58_000 advance
  result = evaluatePaginationLiveness(4, 118_001, state, STALL_WINDOW_MS);
  expect(result.stalled).toBe(true); // 60_001ms since the 58_000 advance
});

test("a count going backwards (unexpected) is treated as no-advance, not a crash", () => {
  const state: PaginationLivenessState = { count: 8, lastAdvanceAt: 0 };
  const result = evaluatePaginationLiveness(3, 60_000, state, STALL_WINDOW_MS);
  expect(result.stalled).toBe(true);
  expect(result.state.count).toBe(8); // lastAdvanceAt tracking is unchanged
});

/**
 * Fail-hard policy integration tests (owner finding #11): an incomplete
 * pagination run — one that never signals `window.__PAGED_RENDERED__`,
 * whether because the `.pagedjs_page` count stalled or the outer wait timed
 * out — must throw a BuildError from `paginateAndCapture` instead of warning
 * and letting a caller print/serialize a truncated DOM as if it were a
 * finished document. These drive the REAL `paginateAndCapture` (not just the
 * pure `evaluatePaginationLiveness` decision above) against a fake puppeteer
 * `Page` — mirrors the mocking approach in browser-pool.test.ts — so no real
 * Chromium/browser is needed and the (production) 10s/60s poll/stall windows
 * are overridden via `paginateAndCapture`'s `livenessConfig` seam to
 * millisecond-scale so the tests run fast.
 */

/**
 * Minimal fake satisfying the puppeteer `Page` members `paginateAndCapture`
 * touches: `setViewport`/`setDefaultNavigationTimeout`/`setDefaultTimeout`/
 * `goto` are no-ops; `evaluate` is called once up-front for
 * `document.fonts.ready` (resolved with `undefined`) and then once per
 * liveness poll for the `.pagedjs_page` count, returning the next entry of
 * `counts` (the last entry repeats once the sequence is exhausted, so a
 * short array can still back an arbitrary number of polls); `waitForFunction`
 * is caller-supplied so each test controls whether/when the
 * `__PAGED_RENDERED__` wait "signals".
 */
function makeFakePage(config: {
  counts: number[];
  waitForFunction: () => Promise<void>;
}): Page {
  let evaluateCalls = 0;
  const fake = {
    setViewport: async () => {},
    setDefaultNavigationTimeout: () => {},
    setDefaultTimeout: () => {},
    goto: async () => {},
    evaluate: async () => {
      evaluateCalls++;
      if (evaluateCalls === 1) return undefined; // document.fonts.ready
      const idx = Math.min(evaluateCalls - 2, config.counts.length - 1);
      return config.counts[idx];
    },
    waitForFunction: config.waitForFunction,
  };
  return fake as unknown as Page;
}

/** __PAGED_RENDERED__ never fires — the returned promise never settles, so the
 *  stall/timeout path (whichever the test is driving) always wins the race. */
function neverSignals(): Promise<void> {
  return new Promise(() => {});
}

/** Simulates puppeteer's real behavior: `waitForFunction` rejects with a
 *  `TimeoutError` (matched by `.name`, same as the real puppeteer-core class)
 *  after `ms` — standing in for the outer `timeoutMs` wait expiring. */
function timesOutAfter(ms: number): () => Promise<void> {
  return () =>
    new Promise((_resolve, reject) => {
      setTimeout(() => {
        const err = new Error("waitForFunction timeout (fake)");
        err.name = "TimeoutError";
        reject(err);
      }, ms);
    });
}

test("a plateaued page count (stall) that never signals __PAGED_RENDERED__ throws a BuildError, not a warn-and-continue", async () => {
  const page = makeFakePage({
    counts: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], // flat — never advances past 3
    waitForFunction: neverSignals,
  });

  let caught: unknown;
  try {
    await paginateAndCapture(page, "http://127.0.0.1:0/book.html", 999_000, undefined, {
      pollIntervalMs: 5,
      stallWindowMs: 30,
    });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(BuildError);
  expect((caught as BuildError).message).toContain(
    "Pagination did not complete — output would be truncated"
  );
  expect((caught as BuildError).message).toContain("stalled at 3 page(s)");
});

test("a page count that never gets off zero (dead chunker) throws a BuildError", async () => {
  const page = makeFakePage({
    counts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    waitForFunction: neverSignals,
  });

  await expect(
    paginateAndCapture(page, "http://127.0.0.1:0/book.html", 999_000, undefined, {
      pollIntervalMs: 5,
      stallWindowMs: 30,
    })
  ).rejects.toThrow(BuildError);
});

test("a wait timeout (page count keeps advancing but __PAGED_RENDERED__ never fires) throws a BuildError instead of shipping the partial DOM", async () => {
  const page = makeFakePage({
    // Keeps advancing on every poll, so the stall detector never fires — only
    // the outer wait-timeout path can be responsible for the throw here. The
    // stall window is set absurdly large so it categorically cannot win the
    // race in a fast test.
    counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    waitForFunction: timesOutAfter(15),
  });

  let caught: unknown;
  try {
    await paginateAndCapture(page, "http://127.0.0.1:0/book.html", 999_000, undefined, {
      pollIntervalMs: 5,
      stallWindowMs: 1_000_000,
    });
  } catch (err) {
    caught = err;
  }

  expect(caught).toBeInstanceOf(BuildError);
  expect((caught as BuildError).message).toContain(
    "Pagination did not complete — output would be truncated"
  );
  expect((caught as BuildError).message).toContain("no __PAGED_RENDERED__ signal");
});

test("a render that signals __PAGED_RENDERED__ before any stall/timeout completes successfully (no BuildError)", async () => {
  const page = makeFakePage({
    counts: [1, 2, 3],
    waitForFunction: () => Promise.resolve(),
  });

  await expect(
    paginateAndCapture(page, "http://127.0.0.1:0/book.html", 999_000, undefined, {
      // Large enough that neither a stall nor a poll can matter before the
      // wait resolves — isolates this test to the "rendered" outcome only.
      pollIntervalMs: 1_000_000,
      stallWindowMs: 1_000_000,
    })
  ).resolves.toBeUndefined();
});
