/**
 * Preflight classification at project-open (2026-08-14 simplification).
 *
 * Exercises the REAL `classifyFromHealth` lib export. Every structural
 * condition collapses to "needs_repair" (one automatic repair pipeline);
 * a sweepable lock is "stale_lock"; a healthy repo is null.
 */
import { describe, test, expect } from "bun:test";
import { classifyFromHealth, STALE_LOCK_MIN_AGE_MS, type RepoHealth } from "gutterpress";

function health(overrides: Partial<RepoHealth> = {}): RepoHealth {
  return {
    hasGitDir: true,
    isDetachedHead: false,
    headUnreadable: false,
    hasStaleLock: false,
    hasLocalChanges: false,
    ...overrides,
  };
}

describe("classifyFromHealth (preflight)", () => {
  test("healthy repo → null (no repair)", () => {
    expect(classifyFromHealth(health())).toBeNull();
  });

  test("every structural condition → needs_repair", () => {
    for (const overrides of [
      { hasGitDir: false },
      { interruptedOperation: "merge" },
      { interruptedOperation: "rebase" },
      { interruptedOperation: "cherry-pick" },
      { headUnreadable: true },
      { isDetachedHead: true },
    ] as Partial<RepoHealth>[]) {
      expect(classifyFromHealth(health(overrides))).toBe("needs_repair");
    }
  });

  test("stale lock is age-gated at preflight (a live process may hold a fresh one)", () => {
    expect(
      classifyFromHealth(health({ hasStaleLock: true, lockAgeMs: 1_000 })),
    ).toBeNull();
    expect(
      classifyFromHealth(health({ hasStaleLock: true, lockAgeMs: STALE_LOCK_MIN_AGE_MS + 1 })),
    ).toBe("stale_lock");
  });
});
