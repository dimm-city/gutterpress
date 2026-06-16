/**
 * recover-non-fast-forward.ts — thin wrapper over syncProject.
 *
 * WHY this exists: when a push is rejected because the online copy has commits
 * this computer doesn't have, the correct fix is pull-then-push — which is
 * exactly what syncProject already does. This handler just calls syncProject
 * and maps its typed SyncOutcome to the RecoveryResult contract.
 *
 * NO backup is created (policy.createBackup = false for non_fast_forward):
 * syncProject takes its own snapshot before touching anything (ADR 0006 D5),
 * so the user's work is safe without an additional zip.
 *
 * NO force-push is ever used: syncProject/pullChanges/pushChanges use only
 * the normal git.push(), which the server rejects when a force-push would be
 * needed. The safety invariant is proved by gitSpy in the test.
 *
 * Outcome mapping:
 *   SyncOutcome.status   → RecoveryResult.status
 *   'synced'             → 'recovered'
 *   'up-to-date'         → 'recovered'  (local commits all landed; nothing new)
 *   'conflict'           → 'needs_user' (let the user choose per file)
 *   'auth'               → 'needs_user' (guidance: reconnect)
 *   'offline'            → 'retry_later'
 *   'error'              → 'failed_no_changes_made'
 */

import { syncProject } from "../sync.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoverFn } from "./types.ts";

export const recover: RecoverFn = async (ctx, _error) => {
  const outcome = await syncProject({
    projectDir: ctx.projectDir,
    credential: ctx.credential,
    tokenStore: ctx.tokenStore,
    authorName: ctx.authorName,
    httpClient: ctx.httpClient,
  });

  switch (outcome.status) {
    case "synced":
    case "up-to-date":
      return {
        status: "recovered",
        message: outcome.message,
      };

    case "conflict":
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "merge_conflict"),
        files: outcome.files,
      };

    case "auth":
      return {
        status: "needs_user",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "auth_required"),
      };

    case "offline":
      return {
        status: "retry_later",
        message: outcome.message,
        // 30-second retry interval — long enough not to hammer the network
        // while the user reconnects, short enough to feel responsive.
        retryAfterMs: 30_000,
      };

    default:
      // 'error' or any future status: no repair was run, no remote was changed.
      return {
        status: "failed_no_changes_made",
        message: outcome.message,
        guidance: makeManualGuidance(ctx, "non_fast_forward"),
      };
  }
};
