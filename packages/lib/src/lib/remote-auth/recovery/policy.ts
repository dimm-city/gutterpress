/**
 * Recovery policy matrix — pure data, no I/O.
 *
 * Each SyncErrorKind maps to a policy that controls:
 *   - risk: how much irreversible change the repair makes
 *   - createBackup: whether the repair MUST create a /tmp zip before running
 *   - requireConfirmation: whether the user must approve the repair
 *   - mayChangeLocalFiles: whether the repair can modify user-visible files
 *   - mayChangeGitMetadata: whether the repair can modify .git/ metadata
 *   - mayChangeRemote: whether the repair can push to the remote
 *   - automate: whether the repair can run without user interaction at all
 *
 * Safety invariants (from the spec):
 *   - detached_head, corrupt_index, missing_git_dir, missing_or_corrupt_objects,
 *     unrelated_histories, wrong_remote_or_branch → always backup + confirm
 *   - auth_required, network_unavailable, non_fast_forward → no backup needed,
 *     no confirmation required (they are thin delegates to sync.ts)
 */

import type { RecoveryRisk, SyncErrorKind } from "./types.ts";

export interface RecoveryPolicy {
  risk: RecoveryRisk;
  createBackup: boolean;
  requireConfirmation: boolean;
  mayChangeLocalFiles: boolean;
  mayChangeGitMetadata: boolean;
  mayChangeRemote: boolean;
  /** True when the repair can run transparently without prompting the user. */
  automate: boolean;
}

export const recoveryPolicy: Record<SyncErrorKind, RecoveryPolicy> = {
  // ── Thin sync.ts delegates — safe, no backup needed ──────────────────────
  non_fast_forward: {
    risk: "low",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: true,
    automate: true,
  },
  merge_conflict: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to choose per-file
  },
  binary_conflict: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to choose per-file
  },
  auth_required: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to reconnect
  },
  network_unavailable: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: true, // retry later automatically
  },

  // ── Structural repairs — always backup + confirm ──────────────────────────
  detached_head: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
  },
  stale_lock: {
    risk: "low",
    createBackup: false,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
  },
  corrupt_index: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
  },
  missing_git_dir: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
  },
  missing_or_corrupt_objects: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
  },
  unrelated_histories: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // always block; no auto-fix
  },
  wrong_remote_or_branch: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // block with guidance
  },
  unknown: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false,
  },
};

/** Look up the policy for a kind (always succeeds — every kind has an entry). */
export function policyFor(kind: SyncErrorKind): RecoveryPolicy {
  return recoveryPolicy[kind];
}

/**
 * Refinement: detached HEAD with local changes is riskier — escalate to high
 * risk and always require confirmation regardless of the base policy.
 */
export function detachedHeadWithLocalChangesPolicy(
  hasLocalChanges: boolean,
): RecoveryPolicy {
  const base = recoveryPolicy.detached_head;
  if (!hasLocalChanges) return base;
  return {
    ...base,
    risk: "high",
    requireConfirmation: true,
  };
}
