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
  // NEVER "reconnect" — reconnecting can't fix an http:// address, and the
  // reconnect path deletes stored credentials.
  insecure_transport: "check_connection",
  detached_head: "restore_repo",
  stale_lock: "restore_repo",
  corrupt_index: "restore_repo",
  missing_git_dir: "restore_repo",
  missing_or_corrupt_objects: "restore_repo",
  unrelated_histories: "restore_repo",
  wrong_remote_or_branch: "check_connection",
  interrupted_rebase: "restore_repo",
  interrupted_cherry_pick: "restore_repo",
  interrupted_merge: "restore_repo",
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

  test("backup reassurance is honest — promised only when a backup exists", () => {
    const backupKinds: SyncErrorKind[] = [
      "detached_head",
      "corrupt_index",
      "missing_git_dir",
      "missing_or_corrupt_objects",
      "unrelated_histories",
      "interrupted_rebase",
      "interrupted_cherry_pick",
      "interrupted_merge",
    ];
    for (const kind of backupKinds) {
      // With a backup: exactly one safety-copy line, affirming the copy exists.
      const withBackup = makeManualGuidance(ctx, kind, undefined, "/tmp/x.zip");
      const affirm = (withBackup.safeNextSteps ?? []).filter((s) =>
        /safety copy/i.test(s),
      );
      expect(affirm).toHaveLength(1);
      expect(affirm[0]).toContain("was saved");
      expect(withBackup.backupZipPath).toBe("/tmp/x.zip");

      // Without a backup (backup creation FAILED): never claim a copy was or
      // will be saved — say honestly that it couldn't be, and nothing changed.
      const withoutBackup = makeManualGuidance(ctx, kind);
      const lines = withoutBackup.safeNextSteps ?? [];
      expect(lines.some((s) => /safety copy could not be saved/i.test(s))).toBe(true);
      expect(lines.some((s) => /copy (of your (project|files|work) )?(was|will be|is) saved/i.test(s))).toBe(false);
      expect(withoutBackup.backupZipPath).toBeUndefined();
    }
  });

  test("non-backup kinds get no failed-backup line", () => {
    for (const kind of ["auth_required", "network_unavailable", "unknown"] as SyncErrorKind[]) {
      const g = makeManualGuidance(ctx, kind);
      expect((g.safeNextSteps ?? []).some((s) => /could not be saved/i.test(s))).toBe(false);
    }
  });

  // Characterization: full byte-for-byte output for a representative sample of
  // kinds (plain, prefixed-supportDetails with/without backup, and default).
  // This must stay green through any DRY refactor of the copy table.
  test("full output is byte-identical for representative kinds", () => {
    const err = new Error("boom detail");

    expect(makeManualGuidance(ctx, "non_fast_forward", err)).toEqual({
      userSummary:
        "The online copy has new changes. Your work is saved — please sync again to combine everything.",
      recommendedNextStep:
        "Sync your project to combine your changes with the online version.",
      recommendedAction: "Sync now",
      recommendedActionKey: "sync",
      safeNextSteps: [
        "Your changes are saved on this computer and won't be lost.",
        "Syncing will combine your version and the online version automatically.",
      ],
      supportDetails: "Error kind: non_fast_forward. Detail: boom detail",
    });

    expect(makeManualGuidance(ctx, "interrupted_rebase", err)).toEqual({
      userSummary:
        "Your project's last update didn't finish, so it can't be synced yet.",
      recommendedNextStep:
        "Let print-md undo the unfinished update and return your project to its last working state.",
      recommendedAction: "Restore to normal",
      recommendedActionKey: "restore_repo",
      safeNextSteps: [
        "None of your content files are deleted.",
        "A safety copy could not be saved, so nothing was changed.",
      ],
      supportDetails:
        "Interrupted rebase detected. Error kind: interrupted_rebase. Detail: boom detail",
    });

    expect(
      makeManualGuidance(ctx, "interrupted_cherry_pick", err, "/tmp/x.zip"),
    ).toEqual({
      backupZipPath: "/tmp/x.zip",
      userSummary:
        "Your project's last update didn't finish, so it can't be synced yet.",
      recommendedNextStep:
        "Let print-md undo the unfinished update and return your project to its last working state.",
      recommendedAction: "Restore to normal",
      recommendedActionKey: "restore_repo",
      safeNextSteps: [
        "None of your content files are deleted.",
        "A safety copy of your project was saved first — anything the repair changes can be retrieved from it.",
      ],
      supportDetails:
        "Interrupted cherry-pick detected. Error kind: interrupted_cherry_pick. Detail: boom detail",
    });

    expect(makeManualGuidance(ctx, "interrupted_merge", err, "/tmp/x.zip")).toEqual({
      backupZipPath: "/tmp/x.zip",
      userSummary:
        "Your project's last update didn't finish, so it can't be synced yet.",
      recommendedNextStep:
        "Let print-md undo the unfinished update and return your project to its last working state.",
      recommendedAction: "Restore to normal",
      recommendedActionKey: "restore_repo",
      safeNextSteps: [
        "None of your content files are deleted.",
        "A safety copy of your project was saved first — anything the repair changes can be retrieved from it.",
      ],
      supportDetails:
        "Interrupted merge detected. Error kind: interrupted_merge. Detail: boom detail",
    });

    expect(makeManualGuidance(ctx, "unknown", err)).toEqual({
      userSummary:
        "Something unexpected went wrong while syncing. Your work is saved on this computer.",
      recommendedNextStep:
        "Try syncing again. If the problem continues, contact support.",
      recommendedAction: "Try again",
      recommendedActionKey: "sync",
      safeNextSteps: [
        "Your work is saved on this computer.",
        "Nothing was changed online.",
      ],
      supportDetails: "Error kind: unknown. Detail: boom detail",
    });

    expect(makeManualGuidance(ctx, "auth_required")).toEqual({
      userSummary:
        "The online repository didn't accept the saved connection. You need to reconnect.",
      recommendedNextStep: "Reconnect your account and try syncing again.",
      recommendedAction: "Reconnect",
      recommendedActionKey: "reconnect",
      safeNextSteps: [
        "Your work is saved on this computer.",
        "Nothing was sent or changed online.",
      ],
      supportDetails: "Error kind: auth_required",
    });
  });

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
