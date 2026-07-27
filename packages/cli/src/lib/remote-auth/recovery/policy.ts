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
 *     unrelated_histories → always backup + confirm
 *   - auth_required, network_unavailable, non_fast_forward → no backup needed,
 *     no confirmation required (they are thin delegates to sync.ts)
 *   - wrong_remote_or_branch → no repair attempted (pure block with guidance),
 *     so no backup is needed either
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
  /**
   * True when the dispatcher must run the handler inside withRepoLock (the
   * per-repo FIFO queue): every handler that mutates `.git` via RAW git.* /
   * node:fs calls. MUST be false for the thin sync.ts delegates — they call
   * lock-wrapped functions (syncProject/pullChanges) internally, and the FIFO
   * queue is non-reentrant (locking them at the dispatcher would deadlock).
   */
  serializeRepo: boolean;
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
    serializeRepo: false,
  },
  merge_conflict: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to choose per-file
    serializeRepo: false,
  },
  binary_conflict: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to choose per-file
    serializeRepo: false,
  },
  auth_required: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // needs user to reconnect
    serializeRepo: false,
  },
  network_unavailable: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: true, // retry later automatically
    serializeRepo: false,
  },
  insecure_transport: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // block with guidance — only the user can change the address to https
    serializeRepo: false,
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
    serializeRepo: true,
  },
  stale_lock: {
    risk: "low",
    createBackup: false,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  corrupt_index: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  missing_git_dir: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  missing_or_corrupt_objects: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  unrelated_histories: {
    risk: "high",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: true,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false, // requires confirmation; clean merge updates the working tree
    serializeRepo: true,
  },
  wrong_remote_or_branch: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false, // block with guidance
    serializeRepo: false,
  },
  // An interrupted rebase/cherry-pick is aborted: the branch ref is rewound (or
  // the half-applied index/worktree state cleared) and the operation-state dirs
  // are removed. This resets local files back to the last working state, so it
  // always makes a backup first and always asks the author to confirm.
  interrupted_rebase: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: true,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  interrupted_cherry_pick: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: true,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  // An interrupted merge (MERGE_HEAD left by native git run outside the app)
  // is aborted the same way: the half-applied index/worktree state is cleared
  // and the marker files removed, resetting local files to the last working
  // state — so it always makes a backup first and always asks to confirm.
  interrupted_merge: {
    risk: "medium",
    createBackup: true,
    requireConfirmation: true,
    mayChangeLocalFiles: true,
    mayChangeGitMetadata: true,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: true,
  },
  unknown: {
    risk: "none",
    createBackup: false,
    requireConfirmation: false,
    mayChangeLocalFiles: false,
    mayChangeGitMetadata: false,
    mayChangeRemote: false,
    automate: false,
    serializeRepo: false,
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
