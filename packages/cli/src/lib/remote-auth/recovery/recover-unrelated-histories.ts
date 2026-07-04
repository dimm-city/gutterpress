/**
 * recover-unrelated-histories.ts — Combine local and remote when they share
 * no history.
 *
 * WHY this is needed:
 *   If a user's local project and the configured online project were created
 *   independently — with no shared starting point — a normal merge cannot
 *   combine them. This handler creates a backup, asks the user to confirm,
 *   then performs the combination locally:
 *
 *   1. Fetches the remote tip.
 *   2. Merges the remote into the local branch with
 *      `allowUnrelatedHistories: true`.
 *   3. On clean merge → combined successfully.
 *   4. On file conflicts → surfaces `needs_user` with the conflict file list
 *      and the local/remote OIDs, so the host can show the per-file version
 *      chooser and call `resolveConflicts({ allowUnrelatedHistories: true })`
 *      with the user's choices ("keep mine", "keep theirs", "keep both").
 *
 *   The per-file resolution (merge driver, binary safety, "keep both" →
 *   "(online copy)" rename, delete-conflict equalization, push) is handled
 *   entirely by `sync.ts:resolveConflicts` — this handler just sets up the
 *   merge and surfaces the conflict, exactly like `recover-merge-conflict.ts`
 *   and `recover-binary-conflict.ts`.
 *
 * Safety invariants:
 *   - NEVER pushes to the remote (mayChangeRemote:false in policy). The push
 *     happens later in `resolveConflicts` AFTER the user makes their choices.
 *   - Remote is fetched but never written to.
 *   - Backup zip created and verified BEFORE any repair.
 *   - backup_create fault → failed_no_changes_made, no further writes.
 *   - mid-repair fault → failed_backup_available, backup readable.
 *   - User DENY → blocked, local + remote unchanged, backup still readable.
 *   - No remoteUrl → blocked with guidance.
 *   - Merge conflict → branch unchanged (abortOnConflict:true is the default);
 *     local commits preserved on the branch and in the backup zip. The
 *     conflict file list + OIDs are threaded through so the host can call
 *     `resolveConflicts` after the user decides.
 *
 * Fault injection points:
 *   after_backup_before_repair, fetch, merge
 */

import * as fsSync from "node:fs";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { gitAuthor } from "../../source-provider.ts";
import { conflictFilesFrom, onAuthFor } from "../sync.ts";
import { resolveLogger, shortOid } from "../operation-log.ts";
// The single MergeConflictError decoder lives in classify.ts (there must be
// exactly ONE decoder — see its header); this handler consumes it rather than
// keeping a parallel copy + inline .data cast.
import { isMergeConflictError } from "./classify.ts";
import { withBackupGate } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { ManualGuidance, RecoverFn, RecoveryResult } from "./types.ts";

const fs = fsSync;

const KIND = "unrelated_histories" as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Guidance for the blocked paths (no remote configured / remote ref missing):
 * the repair can't proceed until the project's online connection is fixed, so
 * the primary CTA routes to the connection settings — with a human label
 * (recommendedAction is the literal button text; machine tokens live only in
 * recommendedActionKey).
 */
function buildGuidance(
  ctx: Parameters<typeof makeManualGuidance>[0],
  error?: unknown,
  backupZipPath?: string,
): ManualGuidance {
  const base = makeManualGuidance(ctx, KIND, error, backupZipPath);
  return {
    ...base,
    recommendedAction: "Check connection",
    recommendedActionKey: "check_connection",
  };
}

/**
 * Build a `blocked` result with guidance. Used for the no-remote and
 * no-remote-ref fallback paths.
 */
function blockedResult(
  ctx: Parameters<typeof makeManualGuidance>[0],
  error: unknown,
  backupZipPath: string | undefined,
): RecoveryResult {
  const guidance = buildGuidance(ctx, error, backupZipPath);
  return {
    status: "blocked",
    message: guidance.userSummary,
    guidance,
    ...(backupZipPath ? { backupZipPath } : {}),
  } satisfies RecoveryResult;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export const recover: RecoverFn = async (ctx, error?) => {
  return withBackupGate(
    ctx,
    KIND,
    async (backupZipPath) => {
      await ctx.faults?.before("after_backup_before_repair");

      // Without a remote we cannot combine — block with guidance.
      if (!ctx.remoteUrl) {
        return blockedResult(ctx, error, backupZipPath);
      }

      const dir = ctx.repoDir;
      const branch = ctx.branch || "main";
      const author = gitAuthor(ctx.authorName);
      const logger = resolveLogger(ctx.logFile, "recovery");
      // Per-operation object cache (released when the handler returns — never
      // pin packfile buffers across calls, same rule as sync.ts).
      const cache: Record<string, unknown> = {};

      // Capture the local HEAD before the merge — this is the `localId` the
      // host threads through to `resolveConflicts` if the merge conflicts.
      const headSha = await git.resolveRef({ fs, dir, ref: "HEAD" });
      logger.info("start", "unrelated histories recovery", {
        repo: ctx.repoSlug,
        branch,
        head: shortOid(headSha),
      });

      // ── 1. Fetch the remote ───────────────────────────────────────────────
      // Uses the same authenticated, single-branch fetch pattern as sync.ts's
      // fetchRemoteTip: `ref` is the remote-tracking ref (the last tip the
      // server gave us) so the server finds a common base and sends only new
      // objects. Without this, isomorphic-git sends the local branch tip as
      // the `have` line, and the server ships the ENTIRE repo as one pack
      // (multi-GB download → OOM on large repos). See sync.ts:512-518.
      await ctx.faults?.before("fetch");
      logger.info("fetch", "fetching remote", { branch });
      await git.fetch({
        fs,
        dir,
        http: ctx.httpClient ?? httpNode,
        url: ctx.remoteUrl,
        remote: "origin",
        ref: `refs/remotes/origin/${branch}`,
        remoteRef: branch,
        singleBranch: true,
        tags: false,
        ...onAuthFor(ctx.credential),
      });

      // Resolve the remote tip. Try the tracked branch first, then origin/HEAD
      // (some servers don't configure a per-branch tracking ref on fresh
      // clones). If neither resolves, block — we can't combine without a
      // known remote tip.
      let remoteOid: string;
      try {
        remoteOid = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/origin/${branch}`,
        });
      } catch {
        try {
          remoteOid = await git.resolveRef({
            fs,
            dir,
            ref: "refs/remotes/origin/HEAD",
          });
        } catch {
          logger.warn("fetch", "no remote ref found — blocking");
          return blockedResult(ctx, error, backupZipPath);
        }
      }
      logger.info("fetch", "remote tip resolved", { remote: shortOid(remoteOid) });

      // ── 2. Merge the remote into the local branch ────────────────────────
      // The branch (ours) is at the local HEAD; the remote tip (theirs) is
      // fetched. `allowUnrelatedHistories: true` lets isomorphic-git create a
      // merge commit even though the two sides share no common ancestor.
      //
      // If the merge conflicts, `abortOnConflict: true` (the default) ensures
      // the working tree and branch ref are COMPLETELY unchanged — the local
      // commits are safe on the branch and in the backup zip. We surface the
      // conflict file list + OIDs so the host can call `resolveConflicts`.
      try {
        await ctx.faults?.before("merge");
        logger.info("merge", "merging remote into local", {
          ours: branch,
          theirs: shortOid(remoteOid),
          allowUnrelated: true,
        });
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteOid,
          author,
          message: "Combine your changes with the online version",
          allowUnrelatedHistories: true,
        });
        // Clean merge — sync the working tree to the merge commit.
        await git.checkout({ fs, dir, cache, ref: branch, force: true });
        logger.info("merge", "clean merge — recovered");
        return {
          status: "recovered",
          message:
            "Your project has been combined with the online version successfully.",
          ...(backupZipPath ? { backupZipPath } : {}),
        } satisfies RecoveryResult;
      } catch (mergeErr) {
        if (!isMergeConflictError(mergeErr)) throw mergeErr;

        // ── 3. File conflicts — surface to the user ───────────────────────
        // The shared guard narrows mergeErr.data — no inline cast needed.
        const conflictFiles = conflictFilesFrom(mergeErr.data);
        logger.warn("merge", "merge conflict — surfacing to user", {
          files: conflictFiles.map((f) => f.path),
        });

        return {
          status: "needs_user",
          message:
            "Your changes and the online version both changed some of the same files. " +
            "Choose which version to keep for each file.",
          // Use merge_conflict guidance — the user's situation is now
          // indistinguishable from a regular merge conflict: they need to
          // pick per-file versions. The unrelated_histories guidance is for
          // the blocked path (no remote / can't combine at all). The base
          // guidance already carries the human label + resolve_conflict key.
          guidance: makeManualGuidance(ctx, "merge_conflict", error, backupZipPath),
          files: conflictFiles,
          ...(backupZipPath ? { backupZipPath } : {}),
          // Thread OIDs for resolveConflicts (same convention as
          // recover-binary-conflict.ts).
          localId: headSha,
          remoteId: remoteOid,
        } satisfies RecoveryResult;
      }
    },
    error,
  );
};
