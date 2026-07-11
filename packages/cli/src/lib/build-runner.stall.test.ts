import { test, expect } from "bun:test";
import { evaluatePaginationLiveness, type PaginationLivenessState } from "./build-runner.ts";

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
