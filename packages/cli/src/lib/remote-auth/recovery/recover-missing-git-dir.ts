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
import { defaultGitHttp } from "../git-http.ts";

import { onAuthFor } from "../sync.ts";
import { withBackupGate } from "./failsafe.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoverFn, RecoveryResult, StillAppliesFn } from "./types.ts";

const KIND = "missing_git_dir" as const;

/**
 * Precondition probe (see types.ts `StillAppliesFn`): `.git/` may have
 * reappeared between classification and dispatch (e.g. the author restored
 * the folder or ran an init in a terminal). The dispatcher calls this INSIDE
 * withRepoLock, immediately before invoking `recover` below, replacing what
 * used to be a hand-rolled upfront check duplicated here.
 */
export const stillApplies: StillAppliesFn = async (ctx) => {
  return !fs.existsSync(path.join(ctx.repoDir, ".git"));
};

export const recover: RecoverFn = async (ctx, error?) => {
  const destGitDir = path.join(ctx.repoDir, ".git");

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
        http: ctx.httpClient ?? defaultGitHttp,
        dir: tempCloneDir,
        url: remoteUrl,
        singleBranch: true,
        ...(ctx.branch ? { ref: ctx.branch } : {}),
        // Credential → { username, password } via the ONE canonical mapping
        // (transport.onAuthFor, re-exported by sync.ts).
        ...onAuthFor(ctx.credential),
      });

      // ── Fault point: just before copying .git into project dir ────────────
      await ctx.faults?.before("replace_git_dir");

      // Re-verify `.git/` is STILL absent right before the copy. This is
      // DELIBERATELY kept alongside the dispatcher-level `stillApplies` probe
      // above (not a redundant duplicate of it): that probe only closes the
      // window up to the moment the handler starts. Between then and here,
      // withBackupGate has (1) zipped the whole project directory and (2)
      // awaited ctx.confirmation.confirmRepair() — a real user-interaction
      // wait with no time bound. `.git/` reappearing during that wait (the
      // author restores the folder, or runs an init, while the confirm dialog
      // is still open) is a real, not theoretical, TOCTOU window. fs.cp would
      // MERGE into a directory that appeared in that window — never do that.
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
    await git.currentBranch({ fs, dir: ctx.repoDir });

    const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);

    return {
      status: "recovered",
      message: guidance.userSummary,
      ...(backupZipPath ? { backupZipPath } : {}),
    } satisfies RecoveryResult;
  }, error);
};
