/**
 * Plain-language guidance builders for the sync-recovery subsystem.
 *
 * AUTHOR-FACING COPY RULES (non-negotiable):
 *   - No git words ("branch", "commit", "rebase", "ref", "HEAD", etc.)
 *   - No tokens or credentials
 *   - No internal file paths (no .git/, no /tmp paths in userSummary)
 *   - No technical error codes in user-facing fields
 *   - supportDetails MAY contain technical info for support tickets
 *
 * Each SyncErrorKind gets its own copy block. The host maps the
 * ManualGuidance to its display surface.
 */

import { policyFor } from "./policy.ts";
import type {
  ManualGuidance,
  RecoveryActionKey,
  RecoveryContext,
  SyncErrorKind,
} from "./types.ts";

/**
 * Build a ManualGuidance for a given error kind. The guidance is shown when
 * a repair is blocked, failed, or needs user action. Never throws.
 *
 * SAFETY-COPY HONESTY: the "a safety copy was saved" reassurance is generated
 * in ONE place, from the actual `backupZipPath` — never hardcoded per kind.
 * The backup gate creates (and verifies) the zip BEFORE confirmation, so
 * whenever this guidance is shown for a backup-requiring kind, a present
 * backupZipPath means the copy really exists, and an absent one means backup
 * creation FAILED and nothing was changed (failsafe.ts returns
 * failed_no_changes_made without any writes). Promising a safety copy in that
 * second case would be false — the one moment the promise matters most.
 */
export function makeManualGuidance(
  ctx: Pick<RecoveryContext, "repoSlug" | "remoteUrl">,
  kind: SyncErrorKind,
  error?: unknown,
  backupZipPath?: string,
): ManualGuidance {
  const guidance = buildGuidance(ctx, kind, error, backupZipPath);

  const backupLine = backupZipPath
    ? "A safety copy of your project was saved first — anything the repair changes can be retrieved from it."
    : policyFor(kind).createBackup
      ? "A safety copy could not be saved, so nothing was changed."
      : undefined;
  if (backupLine) {
    guidance.safeNextSteps = [...(guidance.safeNextSteps ?? []), backupLine];
  }
  return guidance;
}

/**
 * The static, jargon-free copy for one error kind. Everything here is a fixed
 * string constant per kind; the only runtime-computed field (supportDetails) is
 * assembled by buildGuidance from the actual error, optionally with the
 * kind-specific `supportDetailsPrefix` prepended.
 */
interface GuidanceCopy {
  userSummary: string;
  recommendedNextStep: string;
  recommendedAction: string;
  recommendedActionKey: RecoveryActionKey;
  safeNextSteps: string[];
  /**
   * Prepended to the technical supportDetails line (behind a copy button) when
   * present. The interrupted-* kinds share identical author-facing copy and
   * differ ONLY by this prefix, which MUST name the real state so support can
   * act, unlike the jargon-free fields above.
   */
  supportDetailsPrefix?: string;
}

const GUIDANCE: Record<SyncErrorKind, GuidanceCopy> = {
  non_fast_forward: {
    userSummary:
      "The online copy has new changes. Your work is saved — please sync again to combine everything.",
    recommendedNextStep: "Sync your project to combine your changes with the online version.",
    recommendedAction: "Sync now",
    recommendedActionKey: "sync",
    safeNextSteps: [
      "Your changes are saved on this computer and won't be lost.",
      "Syncing will combine your version and the online version automatically.",
    ],
  },

  merge_conflict: {
    userSummary:
      "You and the online copy both changed the same file. Choose which version to keep.",
    recommendedNextStep:
      "Review the files that changed in both places and pick which version to keep for each one.",
    recommendedAction: "Review changes",
    recommendedActionKey: "resolve_conflict",
    safeNextSteps: [
      'Choose "Keep my version", "Use the online version", or "Keep both" for each file.',
      "A safety copy of your work was saved before anything changed.",
    ],
  },

  binary_conflict: {
    userSummary:
      "You and the online copy both changed the same file, and it can't be combined automatically.",
    recommendedNextStep:
      "Choose which version of the file to keep — yours or the online copy.",
    recommendedAction: "Choose version",
    recommendedActionKey: "resolve_conflict",
    safeNextSteps: [
      "Only one version of this file can be kept. You can also save both under different names.",
      "A safety copy of your work was taken before anything changed.",
    ],
  },

  auth_required: {
    userSummary:
      "The online repository didn't accept the saved connection. You need to reconnect.",
    recommendedNextStep:
      "Reconnect your account and try syncing again.",
    recommendedAction: "Reconnect",
    recommendedActionKey: "reconnect",
    safeNextSteps: [
      "Your work is saved on this computer.",
      "Nothing was sent or changed online.",
    ],
  },

  network_unavailable: {
    userSummary:
      "print-md couldn't reach the online repository. Check your connection and try again.",
    recommendedNextStep: "Check your internet connection and try syncing again.",
    recommendedAction: "Try again",
    recommendedActionKey: "sync",
    safeNextSteps: [
      "Your work is saved on this computer.",
      "Nothing was sent or changed online.",
    ],
  },

  // NOT reconnect-flavoured on purpose: reconnecting can't fix an http://
  // address, and the reconnect path is what deletes stored credentials.
  insecure_transport: {
    userSummary:
      "This project's online address isn't secure, so the saved connection can't be used with it.",
    recommendedNextStep:
      "Change the project's online address to a secure one (starting with https://), then try syncing again.",
    recommendedAction: "Check connection",
    recommendedActionKey: "check_connection",
    safeNextSteps: [
      "Your work is saved on this computer.",
      "Nothing was sent — your saved connection is never sent over an insecure address.",
    ],
  },

  detached_head: {
    userSummary:
      "Your project's version history is in an unusual state and can't be synced right now.",
    recommendedNextStep:
      "Let print-md restore your project to a normal state so syncing works again.",
    recommendedAction: "Restore to normal",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "None of your content files will be removed or overwritten.",
    ],
  },

  stale_lock: {
    userSummary:
      "A previous operation didn't finish cleanly and left a lock behind. Removing it should fix syncing.",
    recommendedNextStep:
      "Allow print-md to clear the leftover lock so syncing works again.",
    recommendedAction: "Clear and retry",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "This is a safe operation — only the temporary lock file is removed.",
      "Your content and version history are untouched.",
    ],
  },

  corrupt_index: {
    userSummary:
      "The project's tracking information is damaged. print-md can rebuild it from your saved history.",
    recommendedNextStep:
      "Allow print-md to rebuild the tracking information from your version history.",
    recommendedAction: "Rebuild",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "Your content files and history are not affected.",
    ],
  },

  missing_git_dir: {
    userSummary:
      "The version history for this project seems to be missing. print-md can try to recover it from the online copy.",
    recommendedNextStep:
      "Allow print-md to reconnect your project to its online version history.",
    recommendedAction: "Recover history",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "Your content files will not be overwritten.",
      "If recovery isn't possible, your content is still intact.",
    ],
  },

  missing_or_corrupt_objects: {
    userSummary:
      "Some saved history for this project appears to be missing or damaged.",
    recommendedNextStep:
      "Allow print-md to try fetching the missing history from the online copy.",
    recommendedAction: "Fetch missing history",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "Your current content files are not at risk.",
      "If the missing history can't be restored, you'll see manual steps.",
    ],
  },

  unrelated_histories: {
    userSummary:
      "This project and the online copy were created separately and don't share a starting point.",
    recommendedNextStep:
      "Let print-md combine your work with the online version into one project.",
    recommendedAction: "Combine projects",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "Both your local changes and the online version will be kept.",
      "You may need to review a few files after combining.",
    ],
  },

  interrupted_rebase: {
    userSummary:
      "Your project's last update didn't finish, so it can't be synced yet.",
    recommendedNextStep:
      "Let print-md undo the unfinished update and return your project to its last working state.",
    recommendedAction: "Restore to normal",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "None of your content files are deleted.",
    ],
    supportDetailsPrefix: "Interrupted rebase detected. ",
  },

  interrupted_cherry_pick: {
    userSummary:
      "Your project's last update didn't finish, so it can't be synced yet.",
    recommendedNextStep:
      "Let print-md undo the unfinished update and return your project to its last working state.",
    recommendedAction: "Restore to normal",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "None of your content files are deleted.",
    ],
    supportDetailsPrefix: "Interrupted cherry-pick detected. ",
  },

  interrupted_merge: {
    userSummary:
      "Your project's last update didn't finish, so it can't be synced yet.",
    recommendedNextStep:
      "Let print-md undo the unfinished update and return your project to its last working state.",
    recommendedAction: "Restore to normal",
    recommendedActionKey: "restore_repo",
    safeNextSteps: [
      "None of your content files are deleted.",
    ],
    supportDetailsPrefix: "Interrupted merge detected. ",
  },

  wrong_remote_or_branch: {
    userSummary:
      "The online address or destination for this project doesn't match what's stored. Syncing is paused.",
    recommendedNextStep:
      "Check the online address for this project and reconnect with the correct one.",
    recommendedAction: "Check connection",
    recommendedActionKey: "check_connection",
    safeNextSteps: [
      "Nothing was changed on this computer or online.",
      "You may need to update the online address in your project settings.",
    ],
  },

  unknown: {
    userSummary:
      "Something unexpected went wrong while syncing. Your work is saved on this computer.",
    recommendedNextStep: "Try syncing again. If the problem continues, contact support.",
    recommendedAction: "Try again",
    // "Try again" retries the sync — never a dead no-op, and never reconnect.
    recommendedActionKey: "sync",
    safeNextSteps: [
      "Your work is saved on this computer.",
      "Nothing was changed online.",
    ],
  },
};

function buildGuidance(
  _ctx: Pick<RecoveryContext, "repoSlug" | "remoteUrl">,
  kind: SyncErrorKind,
  error?: unknown,
  backupZipPath?: string,
): ManualGuidance {
  const copy = GUIDANCE[kind] ?? GUIDANCE.unknown;

  const errorMsg = error instanceof Error ? error.message : String(error ?? "");
  const supportDetails = errorMsg
    ? `Error kind: ${kind}. Detail: ${errorMsg.slice(0, 500)}`
    : `Error kind: ${kind}`;

  const guidance: ManualGuidance = {
    userSummary: copy.userSummary,
    recommendedNextStep: copy.recommendedNextStep,
    recommendedAction: copy.recommendedAction,
    recommendedActionKey: copy.recommendedActionKey,
    safeNextSteps: [...copy.safeNextSteps],
    supportDetails: copy.supportDetailsPrefix
      ? `${copy.supportDetailsPrefix}${supportDetails}`
      : supportDetails,
  };
  if (backupZipPath) guidance.backupZipPath = backupZipPath;
  return guidance;
}
