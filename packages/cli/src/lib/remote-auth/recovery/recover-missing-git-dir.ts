/**
 * recover-missing-git-dir.ts — reclone-and-reattach when .git/ is missing.
 *
 * WHY this is needed:
 *   A project folder can lose its .git/ directory if the user copied the
 *   project from a zip archive that stripped hidden directories, or if .git/
 *   was accidentally deleted. Without .git/, no sync operation can run.
 *
 * What this repair does:
 *   1. Creates a /tmp backup of the current folder (user files preserved).
 *   2. Asks the user to confirm the repair.
 *   3. Clones the remote into a TEMP directory (NEVER into the project dir).
 *   4. Copies only the .git/ metadata from the temp clone into the project dir.
 *   5. Cleans up the temp clone directory.
 *   6. Returns status=recovered with user files intact and .git/ restored.
 *
 * Safety invariants:
 *   - The project folder is NEVER deleted or replaced.
 *   - The clone target is always a separate temp dir, never projectDir.
 *   - User content files (outside .git/) are NEVER overwritten.
 *   - No force-push is ever issued.
 *   - Backup created and verified BEFORE any repair runs.
 *   - Backup failure → failed_no_changes_made, no further writes.
 *   - User DENY → blocked, no changes.
 *   - Mid-repair failure → failed_backup_available, backup readable, remote unchanged.
 *   - No remoteUrl → blocked with guidance (reclone is impossible).
 */

import * as fs from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { withBackupGate } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoverFn, RecoveryResult } from "./types.ts";

const KIND = "missing_git_dir" as const;

export const recover: RecoverFn = async (ctx, error?) => {
  const destGitDir = path.join(ctx.repoDir, ".git");

  // TOCTOU guard: `.git/` may have reappeared between classification and now
  // (e.g. the author restored the folder or ran an init in a terminal). There
  // is nothing to repair — and falling through would MERGE a fresh clone's
  // .git into the existing one (fs.cp merges into an existing directory),
  // producing a hybrid of two object stores: corruption worse than either
  // input state. Benign no-op instead.
  if (fs.existsSync(destGitDir)) {
    return {
      status: "recovered",
      message:
        "Your project's version history was already back in place; no changes were needed.",
    } satisfies RecoveryResult;
  }

  // ── Guard: without a remote URL, reclone is impossible ──────────────────────
  if (!ctx.remoteUrl) {
    const guidance = makeManualGuidance(ctx, KIND, error, undefined);
    return {
      status: "needs_user",
      message: guidance.userSummary,
      guidance,
    } satisfies RecoveryResult;
  }
  // Capture after the guard so the narrowed (non-undefined) value survives into
  // the withBackupGate callback closure below (TS can't carry the narrowing
  // across the closure boundary on the ctx property access).
  const remoteUrl = ctx.remoteUrl;

  return withBackupGate(ctx, KIND, async (backupZipPath) => {
    // ── Fault point: just before cloning into temp dir ───────────────────────
    await ctx.faults?.before("clone_temp_repo");

    // Clone into a sibling temp directory — NEVER into projectDir.
    const tempCloneDir = await mkdtemp(path.join(tmpdir(), "print-sync-reclone-"));

    try {
      await git.clone({
        fs,
        http: ctx.httpClient ?? httpNode,
        dir: tempCloneDir,
        url: remoteUrl,
        singleBranch: true,
        ...(ctx.branch ? { ref: ctx.branch } : {}),
        ...(ctx.credential
          ? {
              onAuth: () => ({
                username:
                  ctx.credential!.kind === "github-oauth"
                    ? "x-access-token"
                    : ctx.credential!.username || ctx.credential!.token,
                password: ctx.credential!.token,
              }),
            }
          : {}),
      });

      // ── Fault point: just before copying .git into project dir ────────────
      await ctx.faults?.before("replace_git_dir");

      // Re-verify `.git/` is STILL absent right before the copy (the backup +
      // clone above take real time). fs.cp would MERGE into a directory that
      // appeared in the window — never do that.
      if (fs.existsSync(destGitDir)) {
        return {
          status: "recovered",
          message:
            "Your project's version history was already back in place; no changes were needed.",
          ...(backupZipPath ? { backupZipPath } : {}),
        } satisfies RecoveryResult;
      }

      // Copy only .git/ from the temp clone into the project dir.
      // The project's user files (everything outside .git/) are never touched.
      const srcGitDir = path.join(tempCloneDir, ".git");

      await cp(srcGitDir, destGitDir, { recursive: true });
    } finally {
      // Always clean up the temp clone, even on failure. Best-effort.
      try {
        await rm(tempCloneDir, { recursive: true, force: true });
      } catch {
        // Non-fatal: the temp clone might already be partially cleaned up.
      }
    }

    // Confirm .git is now accessible.
    const branch = await git.currentBranch({ fs, dir: ctx.repoDir });

    const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);

    return {
      status: "recovered",
      message: guidance.userSummary,
      ...(backupZipPath ? { backupZipPath } : {}),
    } satisfies RecoveryResult;
  }, error);
};
