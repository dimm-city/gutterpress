/**
 * Tests for inspectRepo() preflight at project-open.
 *
 * Exercises the REAL `classifyFromHealth` export from electron/recovery-bridge.ts
 * so the tests cover the shipped code, not a reimplemented copy.
 *
 * Verifies:
 * 1. A healthy repo → classifyFromHealth returns null
 * 2. Structural condition (stale lock old enough, ≥ 2 min) → returns "stale_lock"
 * 3. Stale lock under threshold (< 2 min) → treated as healthy (null)
 * 4. Interrupted merge → returns "merge_conflict"
 * 5. Missing git dir → returns "missing_git_dir"
 * 6. Detached head → returns "detached_head"
 * 7. Interrupted rebase → returns "interrupted_rebase" (first-class abort repair)
 * 8. Interrupted cherry-pick → returns "interrupted_cherry_pick" (first-class abort repair)
 *
 * The stale-lock threshold (120_000 ms) MUST match recover-stale-lock.ts's
 * STALE_THRESHOLD_MS — see the BUG 2 describe block below.
 *
 * The preflight orchestration logic in api:preview is integration-tested via the
 * orchestrator tests; here we verify the classification function that drives it.
 */

import { describe, test, expect } from "bun:test";
import { classifyFromHealth } from "../../electron/recovery-bridge";
import type { RepoHealth } from "@dimm-city/print-md";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHealthy(): RepoHealth {
  return {
    hasGitDir: true,
    currentBranch: "main",
    isDetachedHead: false,
    hasStaleLock: false,
    hasInterruptedMerge: false,
    hasInterruptedRebase: false,
    hasInterruptedCherryPick: false,
    hasLocalChanges: false,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("classifyFromHealth (real implementation)", () => {
  test("healthy repo → null (no recovery needed)", () => {
    expect(classifyFromHealth(makeHealthy())).toBeNull();
  });

  test("stale lock older than 2 min → stale_lock", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 150_000 }),
    ).toBe("stale_lock");
  });

  test("stale lock under the 2-min threshold → null (treated as healthy)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 5_000 }),
    ).toBeNull();
  });

  test("stale lock with no lockAgeMs → null (age unknown, treated as fresh)", () => {
    // lockAgeMs undefined → (undefined ?? 0) = 0 < threshold → null
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true }),
    ).toBeNull();
  });

  test("missing git dir → missing_git_dir (takes priority over everything)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasGitDir: false }),
    ).toBe("missing_git_dir");
  });

  test("interrupted merge → merge_conflict", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedMerge: true }),
    ).toBe("merge_conflict");
  });

  test("interrupted rebase → interrupted_rebase (first-class abort repair)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedRebase: true }),
    ).toBe("interrupted_rebase");
  });

  test("interrupted cherry-pick → interrupted_cherry_pick (first-class abort repair)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedCherryPick: true }),
    ).toBe("interrupted_cherry_pick");
  });

  test("detached head (lowest priority when git dir is present) → detached_head", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), isDetachedHead: true, currentBranch: undefined }),
    ).toBe("detached_head");
  });

  test("missing git dir beats stale lock", () => {
    expect(
      classifyFromHealth({
        ...makeHealthy(),
        hasGitDir: false,
        hasStaleLock: true,
        lockAgeMs: 99_999,
      }),
    ).toBe("missing_git_dir");
  });

  test("interrupted merge beats detached head", () => {
    // merge check precedes detached check in classifyFromHealth
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedMerge: true, isDetachedHead: true }),
    ).toBe("merge_conflict");
  });
});

// ── Interrupted rebase/cherry-pick are first-class recovery kinds ─────────────
// An interrupted rebase is NOT a non-fast-forward push rejection and an
// interrupted cherry-pick is NOT an in-tree merge conflict. They each get a
// dedicated abort-based repair, so they classify to their own kinds — never to
// a wrong repair path, and (since a rebase detaches HEAD) never to detached_head.
describe("interrupted rebase/cherry-pick first-class mapping", () => {
  test("interrupted rebase does NOT classify as non_fast_forward", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedRebase: true }),
    ).not.toBe("non_fast_forward");
  });

  test("interrupted rebase yields the interrupted_rebase kind", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedRebase: true }),
    ).toBe("interrupted_rebase");
  });

  test("interrupted rebase beats detached_head (a rebase detaches HEAD)", () => {
    expect(
      classifyFromHealth({
        ...makeHealthy(),
        hasInterruptedRebase: true,
        isDetachedHead: true,
        currentBranch: undefined,
      }),
    ).toBe("interrupted_rebase");
  });

  test("interrupted cherry-pick does NOT classify as merge_conflict (no false repair)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedCherryPick: true }),
    ).not.toBe("merge_conflict");
  });

  test("interrupted cherry-pick yields the interrupted_cherry_pick kind", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedCherryPick: true }),
    ).toBe("interrupted_cherry_pick");
  });
});

// ── BUG 2: stale-lock preflight threshold must agree with the lib handler ──────
// recover-stale-lock.ts uses STALE_THRESHOLD_MS = 120_000 (2 min). If the
// preflight gate is shorter, a lock aged between the two thresholds passes
// preflight (classified stale_lock) but the handler then says "too fresh, retry
// later" → an infinite preflight→retry loop. The gate MUST match the handler.
describe("BUG 2 — stale-lock threshold matches recover-stale-lock.ts (120s)", () => {
  test("a 31s-old lock does NOT classify as stale_lock (below the 2-min handler threshold)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 31_000 }),
    ).toBeNull();
  });

  test("a lock just under 2 min does NOT classify as stale_lock", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 119_000 }),
    ).toBeNull();
  });

  test("a 3-min-old lock DOES classify as stale_lock (above the handler threshold)", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 180_000 }),
    ).toBe("stale_lock");
  });
});
