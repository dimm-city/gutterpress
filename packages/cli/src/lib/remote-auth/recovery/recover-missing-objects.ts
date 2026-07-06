/**
 * recover-missing-objects.ts — safe fetch attempt for missing/corrupt loose objects.
 *
 * WHY this exists:
 *   When isomorphic-git raises a "ReadObjectFail" or similar "missing/corrupt
 *   object" error, the repo's on-disk object store has gaps. The safest repair
 *   is a fetch from the remote: git.fetch() downloads only the objects the
 *   remote has that the local repo is missing. If the remote can fill the gap,
 *   the repo becomes healthy again. If there is no remote, or the fetch cannot
 *   cover the damage, we stop with guidance and a backup.
 *
 * IMPORTANT — why we must verify after fetching:
 *   git.fetch() downloads MISSING objects into the pack store. However, it
 *   NEVER overwrites an already-existing (corrupt) loose object file on disk.
 *   Git's loose-object format uses a content-hash filename; if the file at
 *   .git/objects/xx/yyyy... already exists (even if corrupted), git skips it.
 *   So a corrupt loose object that the remote also has will remain corrupt on
 *   disk after a successful fetch() call. We MUST verify that the object store
 *   is healthy after the fetch — if any read still fails, the repair did not
 *   work and we stop with needs_user guidance instead of a false 'recovered'.
 *
 * Safety invariants (every test asserts these):
 *   I1. We NEVER push — not even a no-op push. Remote history is read-only here.
 *   I2. No force-push (we never call git.push at all).
 *   I3. Remote HEAD and tree are unchanged after this handler runs.
 *   I4. User-visible content files are preserved at all times.
 *   I5. A backup zip is created and verified BEFORE any repair attempt.
 *   I6. If backup creation fails → failed_no_changes_made; no further writes.
 *   I7. If the fetch throws AFTER backup → failed_backup_available; zip readable.
 *   I8. If the user denies the confirmation dialog → blocked, no-op.
 *   I9. All non-recovered results include ManualGuidance with jargon-free copy.
 *
 * Repair flow (inside withBackupGate's risky callback):
 *   1. If no remote URL is configured → stop with needs_user guidance.
 *   2. ctx.faults?.before("fetch") — fault injection point for tests.
 *   3. git.fetch() from the remote (no push, read-only, tags=false).
 *   4. Verify the repair: resolve HEAD + read commit + read tree. If any read
 *      fails, the corrupt object is still on disk → needs_user guidance.
 *   5. If verification succeeds → recovered with the backup path.
 *   6. If fetch throws → withBackupGate catches it → failed_backup_available.
 *
 * No merge logic, no push logic. All structural guard-rails live in
 * withBackupGate (backup → confirm → risky → failsafe on throw).
 */

import * as fs from "node:fs";
import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { onAuthFor } from "../sync.ts";
import { withBackupGate } from "./failsafe.ts";
import { verifyRepoReadable } from "./inspect.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import type { RecoverFn, RecoveryResult, StillAppliesFn } from "./types.ts";

const KIND = "missing_or_corrupt_objects" as const;

/**
 * Precondition probe (see types.ts `StillAppliesFn`): re-probe object-store
 * readability right before the dispatcher hands off to `recover` below,
 * reusing the SAME verifyRepoReadable check the handler itself uses to
 * confirm a fetch actually repaired the store (inspect.ts) — one
 * implementation, not a second copy that could drift. A successful read means
 * the damage is already gone (e.g. a previous fetch attempt already fixed
 * it), so there is nothing left to repair.
 */
export const stillApplies: StillAppliesFn = async (ctx) => {
  try {
    await verifyRepoReadable(ctx.repoDir);
    return false;
  } catch {
    return true;
  }
};

export const recover: RecoverFn = async (ctx, error?) => {
  return withBackupGate(
    ctx,
    KIND,
    async (backupZipPath) => {
      // ── No remote → cannot fetch → stop with guidance ──────────────────────
      if (!ctx.remoteUrl) {
        const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);
        // No remote → nothing to fetch from. Route the CTA to the connection
        // settings with a HUMAN label (recommendedAction is the literal button
        // text; machine tokens belong only in recommendedActionKey).
        return {
          status: "needs_user",
          message: guidance.userSummary,
          guidance: {
            ...guidance,
            recommendedAction: "Check connection",
            recommendedActionKey: "check_connection",
            recommendedNextStep:
              "No online copy is connected. Please make a fresh copy of the project from a safe source.",
            safeNextSteps: [
              ...(guidance.safeNextSteps ?? []),
              "Your content files are still on this computer.",
            ],
          },
          ...(backupZipPath ? { backupZipPath } : {}),
        } satisfies RecoveryResult;
      }

      // ── Fault injection point: before the fetch ────────────────────────────
      await ctx.faults?.before("fetch");

      // ── Safe fetch from remote (read-only — never pushes) ─────────────────
      await git.fetch({
        fs,
        http: ctx.httpClient ?? httpNode,
        dir: ctx.repoDir,
        url: ctx.remoteUrl,
        remote: "origin",
        // Fetch all tags and depth=undefined so we get the full history.
        // This maximises the chance of filling any object-store gaps.
        tags: false,
        singleBranch: false,
        // Reuse sync.ts's credential convention (GitHub OAuth → x-access-token,
        // plain tokens → username/token), so authenticated/private remotes work.
        ...onAuthFor(ctx.credential),
      });

      // ── Verify the repair actually worked ─────────────────────────────────
      // git.fetch() downloads MISSING objects but NEVER overwrites an
      // already-existing corrupt loose object file on disk (git skips files
      // that already exist at the content-hash path). We must probe the
      // object store to confirm the corruption is gone before reporting
      // 'recovered'. If any read still fails, the corrupt file is still
      // there and we must guide the user to get a fresh copy instead.
      let repairVerified = false;
      try {
        await verifyRepoReadable(ctx.repoDir);
        repairVerified = true;
      } catch {
        // At least one object is still unreadable — the fetch filled pack gaps
        // but the corrupt loose object remains on disk. Fall through to the
        // needs_user guidance block below.
        repairVerified = false;
      }

      if (!repairVerified) {
        // The corruption persists. Stop with guidance — a fresh copy is needed.
        const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);
        return {
          status: "needs_user",
          message: guidance.userSummary,
          guidance: {
            ...guidance,
            recommendedAction: "Check connection",
            recommendedActionKey: "check_connection",
            recommendedNextStep:
              "Your project's history has damage that could not be repaired automatically. " +
              "Please make a fresh copy from your online copy, or contact support for help.",
            safeNextSteps: [
              ...(guidance.safeNextSteps ?? []),
              "Your content files are still on this computer.",
            ],
          },
          ...(backupZipPath ? { backupZipPath } : {}),
        } satisfies RecoveryResult;
      }

      // Verification passed — the object store is healthy again.
      const guidance = makeManualGuidance(ctx, KIND, error, backupZipPath);
      return {
        status: "recovered",
        message: guidance.userSummary,
        ...(backupZipPath ? { backupZipPath } : {}),
      } satisfies RecoveryResult;
    },
    error,
  );
};
