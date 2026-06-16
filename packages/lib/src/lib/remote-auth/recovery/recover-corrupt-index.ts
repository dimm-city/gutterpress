/**
 * recover-corrupt-index.ts — repair a corrupt or unreadable .git/index.
 *
 * WHY this is needed:
 *   The git index (staging area) can become corrupt if print-md or the OS
 *   crashes mid-operation. When the index is unreadable, virtually every
 *   git operation fails — status checks, sync, everything. The fix is simple:
 *   delete the bad index and let git rebuild it from the last saved snapshot.
 *   User-visible content files are NEVER touched — uncommitted edits survive.
 *
 * Safety invariants:
 *   - Backup created and verified BEFORE anything is deleted.
 *   - User must confirm before the repair runs.
 *   - If backup creation fails → failed_no_changes_made, no further writes.
 *   - If removal or rebuild throws after backup → failed_backup_available.
 *   - User DENY → blocked (index left exactly as-is).
 *   - Never force-pushes; the repair is entirely local (no remote contact).
 *   - Uncommitted edits in the working tree are NEVER overwritten or discarded.
 *
 * Repair steps (all inside withBackupGate's risky callback):
 *   1. ctx.faults?.before("remove_index") — fault injection point
 *   2. Delete .git/index
 *   3. ctx.faults?.before("rebuild_index") — fault injection point
 *   4. Walk HEAD's tree, call git.resetIndex({ filepath }) for each tracked file.
 *      resetIndex ONLY updates the index metadata (mode/oid/stat) — it does NOT
 *      write to the working-tree file, so uncommitted edits remain byte-for-byte.
 *   5. Return status=recovered
 */

import * as fs from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";

import { withBackupGate } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoverFn, RecoveryResult } from "./types.ts";

const KIND = "corrupt_index" as const;

export const recover: RecoverFn = async (ctx, error?) => {
  return withBackupGate(ctx, KIND, async (backupZipPath) => {
    const indexPath = path.join(ctx.repoDir, ".git", "index");

    // ── Fault point: just before removing the corrupt index ──────────────────
    await ctx.faults?.before("remove_index");

    // Delete the corrupt index — any git read of the index will fail before
    // this, so deleting it is safe. The backup already has a copy.
    if (fs.existsSync(indexPath)) {
      await unlink(indexPath);
    }

    // ── Fault point: just before rebuilding the index from HEAD ──────────────
    await ctx.faults?.before("rebuild_index");

    // Rebuild the index by calling git.resetIndex for each file tracked at HEAD.
    // git.resetIndex updates ONLY the index entry (mode/oid/stat) — it never
    // writes to the working-tree file. This means uncommitted edits to chapter.md
    // (or any other user-visible file) survive byte-for-byte.
    //
    // We walk HEAD's commit tree to discover every tracked filepath, then reset
    // each one so the new index correctly reflects the last saved snapshot.
    const headRef = ctx.branch || "HEAD";
    const headOid = await git.resolveRef({ fs, dir: ctx.repoDir, ref: headRef });
    const headCommit = await git.readCommit({ fs, dir: ctx.repoDir, oid: headOid });

    const trackedPaths: string[] = [];
    async function collectTree(treeOid: string, prefix: string): Promise<void> {
      const { tree } = await git.readTree({ fs, dir: ctx.repoDir, oid: treeOid });
      for (const entry of tree) {
        const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
        if (entry.type === "blob") {
          trackedPaths.push(entryPath);
        } else if (entry.type === "tree") {
          await collectTree(entry.oid, entryPath);
        }
      }
    }
    await collectTree(headCommit.commit.tree, "");

    for (const filepath of trackedPaths) {
      await git.resetIndex({ fs, dir: ctx.repoDir, filepath, ref: headRef });
    }

    const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);

    return {
      status: "recovered",
      message: guidance.userSummary,
      ...(backupZipPath ? { backupZipPath } : {}),
    } satisfies RecoveryResult;
  }, error);
};
