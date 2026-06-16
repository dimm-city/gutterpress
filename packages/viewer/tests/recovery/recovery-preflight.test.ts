/**
 * Tests for inspectRepo() preflight at project-open.
 *
 * Exercises the REAL `classifyFromHealth` export from electron/recovery-bridge.ts
 * so the tests cover the shipped code, not a reimplemented copy.
 *
 * Verifies:
 * 1. A healthy repo → classifyFromHealth returns null
 * 2. Structural condition (stale lock old enough) → classifyFromHealth returns "stale_lock"
 * 3. Stale lock under threshold → treated as healthy (null)
 * 4. Interrupted merge → returns "merge_conflict"
 * 5. Missing git dir → returns "missing_git_dir"
 * 6. Detached head → returns "detached_head"
 * 7. Interrupted rebase → returns "non_fast_forward"
 * 8. Interrupted cherry-pick → returns "merge_conflict"
 *
 * The preflight orchestration logic in api:preview is integration-tested via the
 * orchestrator tests; here we verify the classification function that drives it.
 */

import { describe, test, expect } from "bun:test";
import { classifyFromHealth } from "../../electron/recovery-bridge";
import type { RepoHealth } from "@dimm-city/print-md-lib";

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

  test("stale lock older than 30 s → stale_lock", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasStaleLock: true, lockAgeMs: 60_000 }),
    ).toBe("stale_lock");
  });

  test("stale lock under 30 s threshold → null (treated as healthy)", () => {
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

  test("interrupted rebase → non_fast_forward", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedRebase: true }),
    ).toBe("non_fast_forward");
  });

  test("interrupted cherry-pick → merge_conflict", () => {
    expect(
      classifyFromHealth({ ...makeHealthy(), hasInterruptedCherryPick: true }),
    ).toBe("merge_conflict");
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
