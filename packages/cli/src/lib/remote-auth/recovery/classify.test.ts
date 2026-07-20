/**
 * Tests for classify.ts — classifyGitError must cover all 13 SyncErrorKind values.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import {
  classifyGitError,
  classifyFromHealth,
  classifyTransportFailure,
  isMergeConflictError,
  InsecureTransportError,
} from "./classify.ts";
import type { RepoHealth } from "./types.ts";

// ── isMergeConflictError — the ONE decoder (also used by sync.ts and by
//    recover-unrelated-histories.ts, which must NOT keep its own copy) ─────────

describe("isMergeConflictError", () => {
  test("true only for code === 'MergeConflictError' and narrows the payload", () => {
    const err = {
      code: "MergeConflictError",
      data: {
        filepaths: ["manifest.yaml"],
        bothModified: ["manifest.yaml"],
        deleteByUs: [],
        deleteByTheirs: [],
      },
    };
    expect(isMergeConflictError(err)).toBe(true);
    if (isMergeConflictError(err)) {
      // Type guard narrows .data — recover-unrelated-histories relies on this
      // instead of an inline cast.
      expect(err.data.filepaths).toContain("manifest.yaml");
    }
  });

  test("false for any other error code or shape", () => {
    expect(isMergeConflictError({ code: "PushRejectedError" })).toBe(false);
    expect(isMergeConflictError(new Error("merge conflict"))).toBe(false);
    expect(isMergeConflictError(undefined)).toBe(false);
    expect(isMergeConflictError(null)).toBe(false);
  });
});

// ── Health helpers ────────────────────────────────────────────────────────────

const healthyRepo: RepoHealth = {
  hasGitDir: true,
  currentBranch: "main",
  isDetachedHead: false,
  headUnreadable: false,
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

/** isomorphic-git PushRejectedError for a genuine non-fast-forward. */
function nonFastForwardRejectedError(): Error {
  const e = new Error(
    'Push rejected because it was not a simple fast-forward. Use "force: true" to override.',
  ) as Error & { code: string; data: { reason: string } };
  e.code = "PushRejectedError";
  e.data = { reason: "not-fast-forward" };
  return e;
}

/**
 * A PushRejectedError that is NOT a non-fast-forward (e.g. the server hook
 * declined for permission/policy reasons). isomorphic-git carries the distinct
 * reason in `data.reason`; a forge that rejects via a server hook surfaces as
 * GitPushError whose per-ref error text is not "non-fast-forward".
 */
function permissionPushRejectedError(): Error {
  const e = new Error(
    "One or more branches were not updated: \n  - refs/heads/main: permission denied: not allowed to push",
  ) as Error & { code: string; data: { prettyDetails: string } };
  e.code = "GitPushError";
  e.data = {
    prettyDetails: "\n  - refs/heads/main: permission denied: not allowed to push",
  };
  return e;
}

/** A ref-resolution failure (missing/corrupt HEAD) from isomorphic-git. */
function missingHeadError(): Error {
  const e = new Error("Could not find HEAD.") as Error & {
    code: string;
    data: { what: string };
  };
  e.code = "NotFoundError";
  e.data = { what: "HEAD" };
  return e;
}

/** A ref-resolution failure rooted in a corrupt packed-refs file. */
function packedRefsError(): Error {
  return new Error("Could not parse packed-refs file: unexpected token");
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

  // ── headUnreadable (M1): HEAD/ref-store corruption is NOT detachment ───────
  // git.currentBranch() THROWING (missing/corrupt .git/HEAD) is recorded as
  // headUnreadable, distinct from isDetachedHead (branch resolves to null
  // cleanly). classifyFromHealth must route headUnreadable to the
  // missing/corrupt-objects repair, not the detached-head repair — checking
  // out a branch on a repo whose HEAD can't be trusted is the wrong fix.
  test("headUnreadable → missing_or_corrupt_objects, not detached_head", () => {
    const unreadable: RepoHealth = { ...healthyRepo, headUnreadable: true };
    expect(classifyFromHealth(unreadable)).toBe("missing_or_corrupt_objects");
    expect(classifyGitError(new Error("some error"), unreadable)).toBe(
      "missing_or_corrupt_objects",
    );
  });

  test("headUnreadable takes priority over isDetachedHead when both are set", () => {
    const both: RepoHealth = { ...healthyRepo, headUnreadable: true, isDetachedHead: true };
    expect(classifyFromHealth(both)).toBe("missing_or_corrupt_objects");
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

// ── Interrupted rebase / cherry-pick beat detached_head (ordering guard) ───────
//
// An in-progress rebase usually leaves HEAD detached, so a mid-rebase repo also
// reports isDetachedHead=true. The interrupted-operation checks MUST run BEFORE
// the detached-head check or the abort-based repair never fires (the repo would
// be sent down the detached-head rescue path instead).

describe("classifyGitError — interrupted rebase/cherry-pick ordering", () => {
  const rebaseHealth: RepoHealth = {
    ...healthyRepo,
    hasInterruptedRebase: true,
    isDetachedHead: true, // a rebase detaches HEAD
    currentBranch: undefined,
  };
  const cherryPickHealth: RepoHealth = {
    ...healthyRepo,
    hasInterruptedCherryPick: true,
  };

  test("interrupted rebase → interrupted_rebase EVEN WHEN isDetachedHead is true", () => {
    expect(classifyGitError(undefined, rebaseHealth)).toBe("interrupted_rebase");
    expect(classifyGitError(undefined, rebaseHealth)).not.toBe("detached_head");
  });

  test("interrupted cherry-pick → interrupted_cherry_pick even with detached HEAD", () => {
    expect(
      classifyGitError(undefined, { ...cherryPickHealth, isDetachedHead: true }),
    ).toBe("interrupted_cherry_pick");
  });

  test("rebase beats cherry-pick when both are somehow present", () => {
    expect(
      classifyGitError(undefined, { ...rebaseHealth, hasInterruptedCherryPick: true }),
    ).toBe("interrupted_rebase");
  });
});

// ── BUG 1: transient/transport errors beat structural health ──────────────────
//
// A repo can be in a recoverable structural state (detached HEAD, stale lock)
// AND hit a transport error during sync. You cannot repair structure while
// offline or signed out, so the friendly "auth"/"try later" response is the
// correct FIRST reaction — never the scary backup+rescue-branch+confirm flow.

describe("classifyGitError — transport errors beat structural health (BUG 1)", () => {
  test("detached-head health + a NETWORK error → network_unavailable (not detached_head)", () => {
    expect(classifyGitError(networkError(), detachedHealth)).toBe("network_unavailable");
  });

  test("detached-head health + NO error (preflight) → detached_head", () => {
    // With no thrown error (pure preflight), the structural health classifies.
    expect(classifyGitError(undefined, detachedHealth)).toBe("detached_head");
  });

  test("stale-lock health + an AUTH error → auth_required (not stale_lock)", () => {
    expect(classifyGitError(httpAuthError(401), staleLockHealth)).toBe("auth_required");
  });

  test("detached-head health + an AUTH error → auth_required (not detached_head)", () => {
    expect(classifyGitError(httpAuthError(403), detachedHealth)).toBe("auth_required");
  });

  test("missing_git_dir still wins over a transport error (no repo → transport is meaningless)", () => {
    // A transport error is meaningless with no .git — there is nothing to talk
    // to a remote ABOUT, so the missing-repo guidance must take priority.
    expect(classifyGitError(networkError(), missingGitDirHealth)).toBe("missing_git_dir");
    expect(classifyGitError(httpAuthError(401), missingGitDirHealth)).toBe("missing_git_dir");
  });

  test("detached-head health + a non-transport error still classifies as detached_head", () => {
    // A merge-conflict-ish or unknown error is NOT a transient transport
    // failure, so structural health still wins (existing behavior preserved).
    expect(classifyGitError(new Error("checkout failed"), detachedHealth)).toBe(
      "detached_head",
    );
  });
});

// ── Insecure transport: withheld cleartext credential is NOT an auth failure ──
//
// onAuthFor throws a typed error (code "InsecureTransport") instead of sending
// a stored token over non-loopback http. Classifying that as auth_required
// would loop the user through "reconnect" forever AND let recover-auth delete
// the credential for the whole host — so it gets its own kind, checked FIRST.

describe("classifyTransportFailure / classifyGitError — insecure transport", () => {
  function insecureTransportError(): Error {
    return Object.assign(new Error("credential withheld over cleartext http"), {
      code: "InsecureTransport",
    });
  }

  test("classifyTransportFailure recognizes the typed error first → insecure_transport", () => {
    expect(classifyTransportFailure(insecureTransportError())).toBe("insecure_transport");
  });

  test("classifyGitError routes it to insecure_transport, never auth_required", () => {
    expect(classifyGitError(insecureTransportError(), healthyRepo)).toBe("insecure_transport");
  });

  // The viewer's Advanced Setup dialog sanitizes displayed messages with
  // /https?:\/\/\S+/g → "(address hidden)"; a literal "(http://)" in the copy
  // matches it and renders as broken text. Say "https", never "http://".
  test("InsecureTransportError's message contains no URL-shaped token (viewer sanitizer)", () => {
    expect(new InsecureTransportError().message).not.toMatch(/https?:\/\/\S+/);
  });
});

// ── BUG 2: isPushRejected must only fire for a genuine non-fast-forward ────────
//
// A non-fast-forward is the ONLY push rejection that pulling-first can fix.
// Permission/policy rejections must surface to the auth/error classifier so
// the user gets a useful "reconnect" message — not a confusing "someone else
// synced" prompt after two wasted network round-trips.

describe("classifyGitError — push rejection precision (BUG 2)", () => {
  test("genuine non-fast-forward PushRejectedError → non_fast_forward", () => {
    expect(classifyGitError(nonFastForwardRejectedError(), healthyRepo)).toBe(
      "non_fast_forward",
    );
  });

  test("permission-style push rejection does NOT map to non_fast_forward", () => {
    // It must fall through to the friendly auth/error classifier instead.
    expect(classifyGitError(permissionPushRejectedError(), healthyRepo)).not.toBe(
      "non_fast_forward",
    );
  });

  test("permission-style push rejection surfaces as auth_required", () => {
    expect(classifyGitError(permissionPushRejectedError(), healthyRepo)).toBe(
      "auth_required",
    );
  });
});

// ── BUG 3: binary conflict detection on ANY binary file (not EVERY) ───────────

describe("classifyGitError — mixed binary conflict (BUG 3)", () => {
  test("mixed conflict (one .png + one .md) → binary_conflict (any binary present)", () => {
    expect(
      classifyGitError(mergeConflictError(["chapter.md", "cover.png"]), healthyRepo),
    ).toBe("binary_conflict");
  });

  test("all-text conflict stays merge_conflict", () => {
    expect(
      classifyGitError(mergeConflictError(["a.md", "b.md"]), healthyRepo),
    ).toBe("merge_conflict");
  });

  test("all-binary conflict stays binary_conflict", () => {
    expect(
      classifyGitError(mergeConflictError(["a.png", "b.pdf"]), healthyRepo),
    ).toBe("binary_conflict");
  });
});

// ── BUG 4: ref-store corruption (missing HEAD / packed-refs) ──────────────────
//
// A missing/corrupt HEAD or packed-refs is a ref-store problem, NOT a
// missing-repo problem. It must NOT classify as missing_git_dir (whose handler
// would try to clone a remote and talk about "setting up a remote" when the
// real issue is a local corrupt repo).

describe("classifyGitError — ref-store corruption (BUG 4)", () => {
  test("missing/corrupt HEAD (NotFoundError 'Could not find HEAD') → not missing_git_dir / not unknown", () => {
    const kind = classifyGitError(missingHeadError(), healthyRepo);
    expect(kind).not.toBe("missing_git_dir");
    expect(kind).not.toBe("unknown");
    expect(kind).toBe("missing_or_corrupt_objects");
  });

  test("corrupt packed-refs → not missing_git_dir / not unknown", () => {
    const kind = classifyGitError(packedRefsError(), healthyRepo);
    expect(kind).not.toBe("missing_git_dir");
    expect(kind).not.toBe("unknown");
    expect(kind).toBe("missing_or_corrupt_objects");
  });

  test("a ref-resolution failure does NOT get misread as a transport 404", () => {
    // fetchRemoteTip maps a transport NotFoundError(404) to auth; a LOCAL
    // ref-resolution NotFoundError must classify structurally, not as auth.
    expect(classifyGitError(missingHeadError(), healthyRepo)).not.toBe("auth_required");
  });
});
