/**
 * recover-unrelated-histories.ts — BLOCK when local and remote share no history.
 *
 * WHY this is needed:
 *   If a user's local project and the configured online project were created
 *   independently — with no shared starting point — git cannot combine them
 *   safely. This happens when the user configured the wrong online address,
 *   or when the online project was reset to a fresh state.
 *
 * What this handler does:
 *   1. Creates a /tmp backup of the current project (user files + version metadata).
 *   2. Asks the user to confirm they have seen the situation.
 *   3. Returns status="blocked" with plain-language guidance — NO merge, NO
 *      auto-repair, NO force-push.
 *
 * Safety invariants:
 *   - NEVER pushes to the remote (force flag is never set; no push is issued at all).
 *   - NEVER merges or rewrites the local version history.
 *   - User files and remote state are UNCHANGED regardless of outcome.
 *   - Backup created and verified BEFORE asking for confirmation.
 *   - Backup failure → failed_no_changes_made, no further writes.
 *   - User DENY → blocked, local + remote unchanged, backup is still readable.
 *   - After-backup fault → failed_backup_available, backup readable.
 *   - No remoteUrl → still returns blocked (no remote info to act on).
 */

import { withBackupGate } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { ManualGuidance, RecoverFn, RecoveryResult } from "./types.ts";

const KIND = "unrelated_histories" as const;

/**
 * Build guidance with the UI-action label the dispatcher contract requires.
 * The base makeManualGuidance returns "Reconnect"; the feature spec requires
 * the recommendedAction to equal 'reconnect_repo' for UI routing.
 */
function buildGuidance(
  ctx: Parameters<typeof makeManualGuidance>[0],
  error?: unknown,
  backupZipPath?: string,
): ManualGuidance {
  const base = makeManualGuidance(ctx, KIND, error, backupZipPath);
  return {
    ...base,
    recommendedAction: "reconnect_repo",
  };
}

export const recover: RecoverFn = async (ctx, error?) => {
  return withBackupGate(
    ctx,
    KIND,
    async (backupZipPath) => {
      // ── Fault point: just before any action (no risky repair exists) ─────────
      await ctx.faults?.before("after_backup_before_repair");

      // This is a pure BLOCK: there is no auto-repair for unrelated histories.
      // Return blocked with guidance pointing the user at reconnecting to the
      // correct online project.
      const guidance = buildGuidance(ctx, error, backupZipPath);
      return {
        status: "blocked",
        message: guidance.userSummary,
        guidance,
        ...(backupZipPath ? { backupZipPath } : {}),
      } satisfies RecoveryResult;
    },
    error,
  );
};
