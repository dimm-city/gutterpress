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
import { mapOutcomeToResult, syncOptionsFrom } from "./outcome-mapping.ts";
import type { RecoverFn } from "./types.ts";

export const recover: RecoverFn = async (ctx, _error) => {
  const outcome = await syncProject(syncOptionsFrom(ctx));

  // Default map already covers synced/up-to-date → recovered, conflict →
  // needs_user (merge_conflict), auth → needs_user (auth_required), and
  // offline → retry_later (30 s — long enough not to hammer the network while
  // the user reconnects, short enough to feel responsive). Only the `error`
  // arm differs: guidance points at non_fast_forward ("sync again"), not the
  // generic unknown copy. No repair was run, no remote was changed.
  return mapOutcomeToResult(ctx, outcome, {
    error: (c, o) => ({
      status: "failed_no_changes_made",
      message: o.message,
      guidance: makeManualGuidance(c, "non_fast_forward"),
    }),
  });
};
