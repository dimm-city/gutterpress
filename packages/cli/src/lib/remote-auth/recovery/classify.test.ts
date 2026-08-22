/**
 * Classifier tests — the collapsed taxonomy (2026-08-14 simplification).
 *
 * classifyFromHealth answers exactly three things: healthy (null), a
 * sweepable stale lock, or "needs_repair" (every structural condition — the
 * repair pipeline handles them all in one ordered pass). The transport
 * decoders and merge/push guards consumed by sync.ts are pinned here too.
 */
import { describe, expect, test } from "bun:test";

import {
  classifyFromHealth,
  classifyTransportFailure,
  InsecureTransportError,
  isInsecureTransportError,
  isLikelyRepoCorruption,
  isMergeConflictError,
  isPushRejected,
  isRepoNeedsRecoveryError,
  isUnrelatedHistories,
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
    hasInterruptedMerge: false,
    hasInterruptedRebase: false,
    hasInterruptedCherryPick: false,
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
    expect(classifyFromHealth(health({ hasInterruptedRebase: true }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ hasInterruptedCherryPick: true }))).toBe("needs_repair");
    expect(classifyFromHealth(health({ hasInterruptedMerge: true }))).toBe("needs_repair");
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
        health({ hasInterruptedMerge: true, hasStaleLock: true, lockAgeMs: 10 * 60_000 }),
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

describe("isMergeConflictError", () => {
  test("true only for code === 'MergeConflictError' and narrows the payload", () => {
    const err = Object.assign(new Error("merge conflict"), {
      code: "MergeConflictError",
      data: {
        filepaths: ["a.md"],
        bothModified: ["a.md"],
        deleteByUs: [],
        deleteByTheirs: [],
      },
    });
    expect(isMergeConflictError(err)).toBe(true);
    if (isMergeConflictError(err)) {
      expect(err.data.filepaths).toEqual(["a.md"]);
    }
  });

  test("false for any other error code or shape", () => {
    expect(isMergeConflictError(new Error("x"))).toBe(false);
    expect(isMergeConflictError({ code: "PushRejectedError" })).toBe(false);
    expect(isMergeConflictError(null)).toBe(false);
  });
});

describe("isPushRejected", () => {
  test("PushRejectedError: non-fast-forward (or reason-less back-compat) only", () => {
    expect(isPushRejected({ code: "PushRejectedError" })).toBe(true);
    expect(
      isPushRejected({ code: "PushRejectedError", data: { reason: "not-fast-forward" } }),
    ).toBe(true);
    expect(isPushRejected({ code: "PushRejectedError", data: { reason: "tag-exists" } })).toBe(
      false,
    );
  });

  test("GitPushError: only report-status text that says non-fast-forward", () => {
    expect(
      isPushRejected({
        code: "GitPushError",
        data: { prettyDetails: "refs/heads/main non-fast-forward" },
      }),
    ).toBe(true);
    expect(
      isPushRejected({
        code: "GitPushError",
        data: { prettyDetails: "pre-receive hook declined" },
      }),
    ).toBe(false);
  });

  test("anything else is not a push rejection", () => {
    expect(isPushRejected(new Error("ECONNREFUSED"))).toBe(false);
  });
});

describe("isUnrelatedHistories", () => {
  test("MergeNotSupportedError code and message signatures", () => {
    expect(isUnrelatedHistories({ code: "MergeNotSupportedError" })).toBe(true);
    expect(isUnrelatedHistories(new Error("refusing to merge unrelated histories"))).toBe(true);
    expect(isUnrelatedHistories(new Error("no common commits"))).toBe(true);
    expect(isUnrelatedHistories(new Error("plain failure"))).toBe(false);
  });
});

describe("classifyTransportFailure", () => {
  test("insecure transport wins over everything (never 'auth')", () => {
    expect(classifyTransportFailure(new InsecureTransportError())).toBe("insecure_transport");
    expect(isInsecureTransportError(new InsecureTransportError())).toBe(true);
  });

  test("HttpError 401/403/404 → auth_required", () => {
    for (const statusCode of [401, 403, 404]) {
      expect(classifyTransportFailure({ code: "HttpError", data: { statusCode } })).toBe(
        "auth_required",
      );
    }
  });

  test("permission/hook wording → auth_required (never a pull-first)", () => {
    expect(classifyTransportFailure(new Error("remote: permission denied"))).toBe(
      "auth_required",
    );
    expect(
      classifyTransportFailure({
        code: "GitPushError",
        message: "push failed",
        data: { prettyDetails: "pre-receive hook declined" },
      }),
    ).toBe("auth_required");
  });

  test("network errno/wording → network_unavailable", () => {
    expect(classifyTransportFailure(new Error("ENOTFOUND example.com"))).toBe(
      "network_unavailable",
    );
    expect(classifyTransportFailure(new Error("connect ECONNREFUSED"))).toBe(
      "network_unavailable",
    );
    expect(classifyTransportFailure(new Error("fetch failed"))).toBe("network_unavailable");
  });

  test("anything else → null (not a transport failure)", () => {
    expect(classifyTransportFailure(new Error("some logic bug"))).toBeNull();
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
