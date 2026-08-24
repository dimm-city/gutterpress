/**
 * Classifier tests — the collapsed taxonomy (2026-08-14 simplification).
 *
 * classifyFromHealth answers exactly three things: healthy (null), a
 * sweepable stale lock, or "needs_repair" (every structural condition — the
 * repair pipeline handles them all in one ordered pass).
 */
import { describe, expect, test } from "bun:test";

import {
  classifyFromHealth,
  isLikelyRepoCorruption,
  isRepoNeedsRecoveryError,
  RepoNeedsRecoveryError,
  STALE_LOCK_MIN_AGE_MS,
} from "./classify.ts";
import type { RepoHealth } from "./types.ts";

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

describe("classifyFromHealth", () => {
  test("healthy repo → null", () => {
    expect(classifyFromHealth(health())).toBeNull();
  });

  test("every structural condition → needs_repair", () => {
    expect(classifyFromHealth(health({ hasGitDir: false }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ interruptedOperation: "rebase" }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ interruptedOperation: "cherry-pick" }))).toBe(
      "needs_repair",
    );
    expect(classifyFromHealth(health({ interruptedOperation: "merge" }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ headUnreadable: true }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ isDetachedHead: true }))).toBe("needs_repair");
  });

  test("stale lock: age-gated at preflight, immediate for error-path callers", () => {
    const withLock = (ageMs: number) => health({ hasStaleLock: true, lockAgeMs: ageMs });
    // Fresh lock at preflight → healthy (a live process may hold it).
    expect(classifyFromHealth(withLock(1_000))).toBeNull();
    // Old lock at preflight → sweepable.
    expect(classifyFromHealth(withLock(STALE_LOCK_MIN_AGE_MS + 1))).toBe("stale_lock");
    // Error-path callers pass 0: any lock that just made a sync throw routes.
    expect(classifyFromHealth(withLock(1_000), { minLockAgeMs: 0 })).toBe("stale_lock");
  });

  test("a structural condition wins over a stale lock", () => {
    expect(
      classifyFromHealth(
        health({ interruptedOperation: "merge", hasStaleLock: true, lockAgeMs: 10 * 60_000 }),
      ),
    ).toBe("needs_repair");
  });
});

describe("RepoNeedsRecoveryError", () => {
  test("carries the stable code and the repair kind", () => {
    const e = new RepoNeedsRecoveryError("needs_repair");
    expect(e.code).toBe("RepoNeedsRecovery");
    expect(e.kind).toBe("needs_repair");
    expect(isRepoNeedsRecoveryError(e)).toBe(true);
    expect(isRepoNeedsRecoveryError(new Error("x"))).toBe(false);
  });
});

describe("isLikelyRepoCorruption", () => {
  test("object/ref/index corruption signatures → true", () => {
    expect(isLikelyRepoCorruption({ code: "ReadObjectFail", message: "x" })).toBe(true);
    expect(isLikelyRepoCorruption({ code: "ObjectTypeError", message: "x" })).toBe(true);
    expect(
      isLikelyRepoCorruption(
        Object.assign(new Error("Could not find refs/heads/main"), { code: "NotFoundError" }),
      ),
    ).toBe(true);
    expect(isLikelyRepoCorruption(new Error("object not found abc123"))).toBe(true);
    expect(isLikelyRepoCorruption(new Error("invalid index file"))).toBe(true);
  });

  test("transport failures are NEVER corruption (auth beats structure)", () => {
    expect(isLikelyRepoCorruption({ code: "HttpError", data: { statusCode: 401 } })).toBe(false);
    expect(isLikelyRepoCorruption(new Error("connect ECONNREFUSED"))).toBe(false);
  });

  test("ordinary errors → false", () => {
    expect(isLikelyRepoCorruption(new Error("some logic bug"))).toBe(false);
  });
});
