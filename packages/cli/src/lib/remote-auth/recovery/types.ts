/**
 * Shared types and dispatcher contract for the sync-recovery subsystem.
 *
 * Every recover-<x>.ts handler imports from here. This module contains ZERO
 * logic — it is a pure type surface. The dispatcher (dispatch.ts) maps a
 * SyncErrorKind to its handler and is wired in the Integrate phase.
 *
 * Author-facing copy rules: no git words, no tokens, no internal paths visible
 * to users. Every user-visible string lives in manual-guidance.ts.
 */

import type httpNode from "isomorphic-git/http/node";
import type { ConflictFile } from "../sync.ts";
import type { HostCredential, TokenStore } from "../token-store.ts";

// ── Error kind taxonomy ──────────────────────────────────────────────────────

/**
 * Every failure mode the recovery subsystem can handle. The classifier
 * (classify.ts) maps a thrown error + repo health facts to one of these.
 */
export type SyncErrorKind =
  | "non_fast_forward"
  | "merge_conflict"
  | "binary_conflict"
  | "auth_required"
  | "network_unavailable"
  | "detached_head"
  | "stale_lock"
  | "corrupt_index"
  | "missing_git_dir"
  | "missing_or_corrupt_objects"
  | "unrelated_histories"
  | "wrong_remote_or_branch"
  | "interrupted_rebase"
  | "interrupted_cherry_pick"
  | "interrupted_merge"
  | "unknown";

// ── Primary-action keys ──────────────────────────────────────────────────────

/**
 * Machine token for the primary CTA in the guidance dialog. The host switches
 * on this to route the button to the right flow. The human-readable label the
 * button shows lives in `ManualGuidance.recommendedAction` (never this token).
 */
export type RecoveryActionKey =
  | "sync"
  | "reconnect"
  | "resolve_conflict"
  | "restore_repo"
  | "check_connection";

// ── Risk levels ──────────────────────────────────────────────────────────────

/**
 * How much irreversible change a repair makes. The confirmation gate shows
 * a plain-language summary appropriate to the risk level.
 */
export type RecoveryRisk =
  | "none"        // read-only or trivially reversible from the backup
  | "low"         // changes local git metadata; user files intact
  | "medium"      // may change local files; backup lets the user recover
  | "high";       // may discard commits or change the remote

// ── Recovery result ──────────────────────────────────────────────────────────

/**
 * Jargon-free guidance the host shows when a repair is blocked or fails.
 * No git words, no tokens, no internal paths.
 */
export interface ManualGuidance {
  /** One-sentence plain-language summary of what went wrong. */
  userSummary: string;
  /** The single most important action the user should take next. */
  recommendedNextStep: string;
  /** Action label for the primary button in the UI. */
  recommendedAction: string;
  /** Machine token the host switches on to route the primary button's action. */
  recommendedActionKey: RecoveryActionKey;
  /** Optional secondary steps (shown as a list). */
  safeNextSteps?: string[];
  /** Details for a support ticket — may contain technical info. */
  supportDetails?: string;
  /** Path to the backup zip, when one was created before the failure. */
  backupZipPath?: string;
}

/** The backup zip created before a risky repair. */
export interface RecoveryBackup {
  /** Absolute path to the zip file under os.tmpdir()/print-sync-recovery/. */
  zipPath: string;
  /** ISO timestamp the backup was created. */
  createdAt: string;
  /** Files included in the backup (relative paths). */
  entries: string[];
}

/**
 * What a confirmation gate shows the user before a risky repair.
 * The UI must render this information — never silently start a risky repair.
 */
export interface RepairConfirmation {
  repair: SyncErrorKind;
  risk: RecoveryRisk;
  /** Plain-language summary of what the repair will do. */
  summary: string;
  /** Path to the backup zip (already created and verified). */
  backupZipPath: string;
  willChangeLocalFiles: boolean;
  willChangeGitMetadata: boolean;
  willChangeRemote: boolean;
  /** True when the backup alone is enough to undo the repair. */
  canBeUndoneFromBackup: boolean;
}

/** Gate the host must satisfy: show the user what will happen and ask. */
export interface ConfirmationGate {
  confirmRepair(req: RepairConfirmation): Promise<boolean>;
}

/**
 * Outcome of a recovery attempt. Each status maps to a host-side action:
 * - recovered        → refresh the project; show a success toast.
 * - retry_later      → schedule a retry after retryAfterMs; show a soft message.
 * - needs_user       → show the conflict chooser / reconnect dialog.
 * - blocked          → show guidance and a "what do I do?" panel.
 * - failed_no_changes_made → show guidance; nothing was changed locally or remotely.
 * - failed_backup_available → show guidance + "open backup folder" button.
 */
export type RecoveryResult =
  | { status: "recovered"; message: string; backupZipPath?: string }
  | { status: "retry_later"; message: string; retryAfterMs: number }
  | {
      status: "needs_user";
      message: string;
      guidance: ManualGuidance;
      files?: ConflictFile[];
      backupZipPath?: string;
    }
  | { status: "blocked"; message: string; guidance: ManualGuidance; backupZipPath?: string }
  | {
      status: "failed_no_changes_made";
      message: string;
      guidance: ManualGuidance;
    }
  | {
      status: "failed_backup_available";
      message: string;
      backupZipPath: string;
      guidance: ManualGuidance;
    };

// ── Repo health ───────────────────────────────────────────────────────────────

/**
 * Preflight health snapshot of a local repo. Populated by inspectRepo()
 * (inspect.ts) before any recovery decision is made.
 */
export interface RepoHealth {
  /** True when .git/ exists and looks like a valid git dir. */
  hasGitDir: boolean;
  /** Current branch name, or undefined when HEAD is detached. */
  currentBranch?: string;
  /** True when HEAD is detached (no named branch). */
  isDetachedHead: boolean;
  /**
   * True when a leftover git lock file exists (a previous operation may have
   * died). Detects any of index.lock, HEAD.lock, config.lock, packed-refs.lock,
   * or a per-ref refs/**\/*.lock — the same set the stale-lock handler scans.
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

// ── Fault injection (tests only) ─────────────────────────────────────────────

/**
 * Named fault injection points every risky repair MUST call via
 * `ctx.faults?.before(point)`. Throwing from this hook simulates a failure
 * at that exact point so failsafe invariants can be asserted.
 */
export type FaultPoint =
  | "backup_create"
  | "backup_verify"
  | "after_backup_before_repair"
  | "fetch"
  | "merge"
  | "checkout_branch"
  | "abort_interrupted_operation"
  | "remove_operation_state"
  | "create_recovery_branch"
  | "commit_recovery_snapshot"
  | "remove_index_lock"
  | "remove_index"
  | "rebuild_index"
  | "clone_temp_repo"
  | "replace_git_dir"
  | "push"
  | "write_conflict_snapshot"
  | "write_recovery_log";

export interface FaultInjector {
  before(point: FaultPoint): Promise<void>;
}

// ── Recovery context ──────────────────────────────────────────────────────────

/**
 * Everything a recover-<x>.ts handler needs. Extends SyncProjectOptions with
 * the repo-level facts that the dispatcher resolves once and passes down.
 */
export interface RecoveryContext {
  /** The project directory the user opened (may be a repo subfolder). */
  projectDir: string;
  /** Absolute path to the git repository root. */
  repoDir: string;
  /** Current branch name (may be empty on detached HEAD). */
  branch: string;
  /** Sanitized HTTPS remote URL (no embedded credentials). */
  remoteUrl?: string;
  /** Short identifier for the repo used in backup paths. */
  repoSlug: string;
  /** Resolved credential for the remote host. */
  credential?: HostCredential;
  /** Host-keyed credential store (for clearing stale tokens). */
  tokenStore?: TokenStore;
  /** Injectable HTTP transport (real or test mock). */
  httpClient?: typeof httpNode;
  /** The user's display name for snapshot commits. */
  authorName?: string;
  /** Gate the host must satisfy before a risky repair starts. */
  confirmation: ConfirmationGate;
  /** Fault injection hooks (tests only — omit in production). */
  faults?: FaultInjector;
  /** Clock override (tests only). Returns epoch ms. */
  now?: () => number;
  /**
   * Optional path to a log file for debugging. When set, each recovery step
   * (backup, fetch, merge, checkout, etc.) is appended as a timestamped line.
   * Never logs secrets — only repo slug, branch, short OIDs, outcome status.
   */
  logFile?: string;
}

// ── Dispatcher contract ──────────────────────────────────────────────────────

/**
 * The signature every recover-<x>.ts module MUST export.
 * The dispatcher (dispatch.ts) maps SyncErrorKind → RecoverFn.
 */
export type RecoverFn = (ctx: RecoveryContext, error?: unknown) => Promise<RecoveryResult>;
