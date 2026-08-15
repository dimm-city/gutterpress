/**
 * Shared types for the repo health probe + repair pipeline.
 *
 * 2026-08-14 simplification (owner directive): the old handler-dispatch type
 * surface (SyncErrorKind taxonomy, RecoveryContext, RecoveryResult,
 * ManualGuidance, confirmation gates, fault injection) is gone — repair is
 * one automatic pipeline (repair.ts) and needs none of it. What remains is
 * the health snapshot inspect.ts produces.
 */

export interface RepoHealth {
  /** True when .git/ exists and looks like a valid git dir. */
  hasGitDir: boolean;
  /** Current branch name, or undefined when HEAD is detached. */
  currentBranch?: string;
  /** True when HEAD is detached (no named branch). */
  isDetachedHead: boolean;
  /**
   * True when HEAD (or the ref store) could not even be READ — distinct from
   * a clean detached HEAD, where HEAD resolves fine but points at a commit
   * instead of a branch. Routes to the re-clone step of repairRepo.
   */
  headUnreadable: boolean;
  /**
   * True when a leftover git lock file exists (a previous operation may have
   * died). Detects any of index.lock, HEAD.lock, config.lock, packed-refs.lock,
   * or a per-ref refs/**\/*.lock — the same set the lock sweep scans.
   */
  hasStaleLock: boolean;
  /** How old the YOUNGEST detected lock file is in milliseconds, when present. */
  lockAgeMs?: number;
  /** True when a MERGE_HEAD file exists (interrupted merge). */
  hasInterruptedMerge: boolean;
  /** True when a rebase-in-progress directory exists. */
  hasInterruptedRebase: boolean;
  /** True when CHERRY_PICK_HEAD exists. */
  hasInterruptedCherryPick: boolean;
  /** True when the working tree has uncommitted changes. */
  hasLocalChanges: boolean;
}
