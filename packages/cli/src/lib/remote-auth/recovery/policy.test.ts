/**
 * Tests for policy.ts — every SyncErrorKind has a policy; dangerous paths
 * require backup + confirmation; safe paths do not.
 * bun:test only.
 */

import { describe, expect, test } from "bun:test";
import { detachedHeadWithLocalChangesPolicy, policyFor, recoveryPolicy } from "./policy.ts";
import type { SyncErrorKind } from "./types.ts";

const ALL_KINDS: SyncErrorKind[] = [
  "non_fast_forward",
  "merge_conflict",
  "binary_conflict",
  "auth_required",
  "network_unavailable",
  "detached_head",
  "stale_lock",
  "corrupt_index",
  "missing_git_dir",
  "missing_or_corrupt_objects",
  "unrelated_histories",
  "wrong_remote_or_branch",
  "unknown",
];

describe("recoveryPolicy — completeness", () => {
  test("every SyncErrorKind has an entry in the policy matrix", () => {
    for (const kind of ALL_KINDS) {
      expect(recoveryPolicy[kind]).toBeDefined();
    }
  });

  test("policyFor returns the same entry as direct lookup", () => {
    for (const kind of ALL_KINDS) {
      expect(policyFor(kind)).toEqual(recoveryPolicy[kind]);
    }
  });
});

describe("recoveryPolicy — dangerous paths always require backup + confirmation", () => {
  const dangerousKinds: SyncErrorKind[] = [
    "detached_head",
    "corrupt_index",
    "missing_git_dir",
    "missing_or_corrupt_objects",
    "unrelated_histories",
  ];

  for (const kind of dangerousKinds) {
    test(`${kind} — createBackup=true`, () => {
      expect(policyFor(kind).createBackup).toBe(true);
    });

    test(`${kind} — requireConfirmation=true`, () => {
      expect(policyFor(kind).requireConfirmation).toBe(true);
    });
  }
});

describe("recoveryPolicy — safe delegates do NOT require backup", () => {
  const safeDelegates: SyncErrorKind[] = [
    "auth_required",
    "network_unavailable",
    "non_fast_forward",
    "merge_conflict",
    "binary_conflict",
  ];

  for (const kind of safeDelegates) {
    test(`${kind} — createBackup=false`, () => {
      expect(policyFor(kind).createBackup).toBe(false);
    });

    test(`${kind} — requireConfirmation=false`, () => {
      expect(policyFor(kind).requireConfirmation).toBe(false);
    });
  }
});

describe("recoveryPolicy — mayChangeRemote is false unless intentional", () => {
  const kindsAllowedToChangeRemote: SyncErrorKind[] = ["non_fast_forward"];

  for (const kind of ALL_KINDS) {
    if (kindsAllowedToChangeRemote.includes(kind)) {
      test(`${kind} — mayChangeRemote=true (push is part of the fix)`, () => {
        expect(policyFor(kind).mayChangeRemote).toBe(true);
      });
    } else {
      test(`${kind} — mayChangeRemote=false`, () => {
        expect(policyFor(kind).mayChangeRemote).toBe(false);
      });
    }
  }
});

describe("recoveryPolicy — risk levels", () => {
  test("missing_git_dir has risk=high", () => {
    expect(policyFor("missing_git_dir").risk).toBe("high");
  });

  test("missing_or_corrupt_objects has risk=high", () => {
    expect(policyFor("missing_or_corrupt_objects").risk).toBe("high");
  });

  test("unrelated_histories has risk=high", () => {
    expect(policyFor("unrelated_histories").risk).toBe("high");
  });

  test("auth_required has risk=none", () => {
    expect(policyFor("auth_required").risk).toBe("none");
  });

  test("network_unavailable has risk=none", () => {
    expect(policyFor("network_unavailable").risk).toBe("none");
  });

  test("stale_lock has risk=low", () => {
    expect(policyFor("stale_lock").risk).toBe("low");
  });
});

describe("detachedHeadWithLocalChangesPolicy", () => {
  test("without local changes — returns base policy", () => {
    const p = detachedHeadWithLocalChangesPolicy(false);
    expect(p.risk).toBe(policyFor("detached_head").risk);
  });

  test("with local changes — escalates to risk=high", () => {
    const p = detachedHeadWithLocalChangesPolicy(true);
    expect(p.risk).toBe("high");
  });

  test("with local changes — still requires confirmation", () => {
    const p = detachedHeadWithLocalChangesPolicy(true);
    expect(p.requireConfirmation).toBe(true);
  });
});

describe("recoveryPolicy — automate flags", () => {
  test("non_fast_forward — automate=true (delegates to sync.ts transparently)", () => {
    expect(policyFor("non_fast_forward").automate).toBe(true);
  });

  test("network_unavailable — automate=true (retry later)", () => {
    expect(policyFor("network_unavailable").automate).toBe(true);
  });

  test("merge_conflict — automate=false (user must choose)", () => {
    expect(policyFor("merge_conflict").automate).toBe(false);
  });

  test("auth_required — automate=false (user must reconnect)", () => {
    expect(policyFor("auth_required").automate).toBe(false);
  });

  test("detached_head — automate=false (needs confirmation)", () => {
    expect(policyFor("detached_head").automate).toBe(false);
  });
});
