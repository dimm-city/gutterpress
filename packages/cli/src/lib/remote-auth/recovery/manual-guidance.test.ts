/**
 * Tests for makeManualGuidance — verifies every guidance block carries BOTH a
 * non-empty human `recommendedAction` label AND the correct machine
 * `recommendedActionKey` the host routes the primary button on.
 */

import { describe, test, expect } from "bun:test";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoveryActionKey, SyncErrorKind } from "./types.ts";

const ctx = { repoSlug: "demo", remoteUrl: "https://example.com/x.git" };

const EXPECTED: Record<SyncErrorKind, RecoveryActionKey> = {
  non_fast_forward: "sync",
  merge_conflict: "resolve_conflict",
  binary_conflict: "resolve_conflict",
  auth_required: "reconnect",
  network_unavailable: "sync",
  detached_head: "restore_repo",
  stale_lock: "restore_repo",
  corrupt_index: "restore_repo",
  missing_git_dir: "restore_repo",
  missing_or_corrupt_objects: "restore_repo",
  unrelated_histories: "restore_repo",
  wrong_remote_or_branch: "check_connection",
  interrupted_rebase: "restore_repo",
  interrupted_cherry_pick: "restore_repo",
  // "Try again" copy → retry the sync (not a dead no-op).
  unknown: "sync",
};

describe("makeManualGuidance — machine action key", () => {
  for (const [kind, key] of Object.entries(EXPECTED) as [
    SyncErrorKind,
    RecoveryActionKey,
  ][]) {
    test(`${kind} → recommendedActionKey "${key}" with a human label`, () => {
      const g = makeManualGuidance(ctx, kind);
      expect(g.recommendedActionKey).toBe(key);
      expect(typeof g.recommendedAction).toBe("string");
      expect(g.recommendedAction.length).toBeGreaterThan(0);
    });
  }

  test("representative kinds map to the expected keys", () => {
    expect(makeManualGuidance(ctx, "auth_required").recommendedActionKey).toBe(
      "reconnect",
    );
    expect(makeManualGuidance(ctx, "detached_head").recommendedActionKey).toBe(
      "restore_repo",
    );
    expect(makeManualGuidance(ctx, "unknown").recommendedActionKey).toBe(
      "sync",
    );
    expect(
      makeManualGuidance(ctx, "non_fast_forward").recommendedActionKey,
    ).toBe("sync");
  });
});
