/**
 * Tests for classify.ts — classifyGitError must cover all 13 SyncErrorKind values.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import { classifyGitError } from "./classify.ts";
import type { RepoHealth } from "./types.ts";

// ── Health helpers ────────────────────────────────────────────────────────────

const healthyRepo: RepoHealth = {
  hasGitDir: true,
  currentBranch: "main",
  isDetachedHead: false,
  hasStaleLock: false,
  hasInterruptedMerge: false,
  hasInterruptedRebase: false,
  hasInterruptedCherryPick: false,
  hasLocalChanges: false,
};

const detachedHealth: RepoHealth = {
  ...healthyRepo,
  isDetachedHead: true,
  currentBranch: undefined,
};

const staleLockHealth: RepoHealth = {
  ...healthyRepo,
  hasStaleLock: true,
  lockAgeMs: 60_000,
};

const missingGitDirHealth: RepoHealth = {
  ...healthyRepo,
  hasGitDir: false,
};

// ── Error factories ───────────────────────────────────────────────────────────

function pushRejectedError(): Error {
  const e = new Error("push rejected") as Error & { code: string };
  e.code = "PushRejectedError";
  return e;
}

function gitPushNonFastForwardError(): Error {
  const e = new Error("Push rejected because it would not be a fast-forward") as Error & {
    code: string;
  };
  e.code = "GitPushError";
  return e;
}

function mergeConflictError(paths = ["file.md"]): Error {
  const e = new Error("Merge conflict") as Error & {
    code: string;
    data: { filepaths: string[]; bothModified: string[]; deleteByUs: string[]; deleteByTheirs: string[] };
  };
  e.code = "MergeConflictError";
  e.data = { filepaths: paths, bothModified: paths, deleteByUs: [], deleteByTheirs: [] };
  return e;
}

function binaryMergeConflictError(): Error {
  return mergeConflictError(["image.png"]);
}

function httpAuthError(statusCode: 401 | 403): Error {
  const e = new Error("HttpError") as Error & {
    code: string;
    data: { statusCode: number };
  };
  e.code = "HttpError";
  e.data = { statusCode };
  return e;
}

function networkError(): Error {
  return new Error("ENOTFOUND github.com");
}

function unrelatedHistoriesError(): Error {
  return new Error("refusing to merge unrelated histories");
}

function missingObjectsError(): Error {
  const e = new Error("Object not found") as Error & { code: string };
  e.code = "ReadObjectFail";
  return e;
}

function wrongBranchError(): Error {
  const e = new Error("NoRefspecError") as Error & { code: string };
  e.code = "NoRefspecError";
  return e;
}

function corruptIndexError(): Error {
  return new Error("corrupt index file");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("classifyGitError — all 13 SyncErrorKind values", () => {
  test("non_fast_forward — PushRejectedError", () => {
    expect(classifyGitError(pushRejectedError(), healthyRepo)).toBe("non_fast_forward");
  });

  test("non_fast_forward — GitPushError non-fast-forward", () => {
    expect(classifyGitError(gitPushNonFastForwardError(), healthyRepo)).toBe("non_fast_forward");
  });

  test("merge_conflict — MergeConflictError with text file", () => {
    expect(classifyGitError(mergeConflictError(["chapter.md"]), healthyRepo)).toBe("merge_conflict");
  });

  test("binary_conflict — MergeConflictError with .png only", () => {
    expect(classifyGitError(binaryMergeConflictError(), healthyRepo)).toBe("binary_conflict");
  });

  test("auth_required — HttpError 401", () => {
    expect(classifyGitError(httpAuthError(401), healthyRepo)).toBe("auth_required");
  });

  test("auth_required — HttpError 403", () => {
    expect(classifyGitError(httpAuthError(403), healthyRepo)).toBe("auth_required");
  });

  test("auth_required — message contains 'unauthorized'", () => {
    expect(classifyGitError(new Error("unauthorized request"), healthyRepo)).toBe("auth_required");
  });

  test("network_unavailable — ENOTFOUND", () => {
    expect(classifyGitError(networkError(), healthyRepo)).toBe("network_unavailable");
  });

  test("network_unavailable — ECONNREFUSED", () => {
    expect(classifyGitError(new Error("ECONNREFUSED"), healthyRepo)).toBe("network_unavailable");
  });

  test("detached_head — health flag wins over any error", () => {
    expect(classifyGitError(new Error("checkout failed"), detachedHealth)).toBe("detached_head");
  });

  test("detached_head — takes priority even over push rejected", () => {
    expect(classifyGitError(pushRejectedError(), detachedHealth)).toBe("detached_head");
  });

  test("stale_lock — health flag (hasStaleLock=true)", () => {
    expect(classifyGitError(new Error("some error"), staleLockHealth)).toBe("stale_lock");
  });

  test("missing_git_dir — health flag (hasGitDir=false) is top priority", () => {
    expect(classifyGitError(new Error("some error"), missingGitDirHealth)).toBe("missing_git_dir");
  });

  test("missing_or_corrupt_objects — ReadObjectFail code", () => {
    expect(classifyGitError(missingObjectsError(), healthyRepo)).toBe("missing_or_corrupt_objects");
  });

  test("missing_or_corrupt_objects — message 'object not found'", () => {
    expect(
      classifyGitError(new Error("bad object sha1234"), healthyRepo),
    ).toBe("missing_or_corrupt_objects");
  });

  test("unrelated_histories — message match", () => {
    expect(classifyGitError(unrelatedHistoriesError(), healthyRepo)).toBe("unrelated_histories");
  });

  test("wrong_remote_or_branch — NoRefspecError", () => {
    expect(classifyGitError(wrongBranchError(), healthyRepo)).toBe("wrong_remote_or_branch");
  });

  test("corrupt_index — message 'corrupt index file'", () => {
    expect(classifyGitError(corruptIndexError(), healthyRepo)).toBe("corrupt_index");
  });

  test("unknown — unrecognized error with healthy repo", () => {
    expect(classifyGitError(new Error("something completely unknown"), healthyRepo)).toBe(
      "unknown",
    );
  });

  test("unknown — null error, no health", () => {
    expect(classifyGitError(null)).toBe("unknown");
  });

  test("missing_git_dir has priority over detached_head", () => {
    const both: RepoHealth = { ...missingGitDirHealth, isDetachedHead: true };
    expect(classifyGitError(new Error("x"), both)).toBe("missing_git_dir");
  });
});
