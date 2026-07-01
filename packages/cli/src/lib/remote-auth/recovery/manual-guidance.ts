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

import type { ManualGuidance, RecoveryContext, SyncErrorKind } from "./types.ts";

/**
 * Build a ManualGuidance for a given error kind. The guidance is shown when
 * a repair is blocked, failed, or needs user action. Never throws.
 */
export function makeManualGuidance(
  ctx: Pick<RecoveryContext, "repoSlug" | "remoteUrl">,
  kind: SyncErrorKind,
  error?: unknown,
  backupZipPath?: string,
): ManualGuidance {
  const base: Partial<ManualGuidance> = {};
  if (backupZipPath) base.backupZipPath = backupZipPath;

  const errorMsg = error instanceof Error ? error.message : String(error ?? "");
  const supportDetails = errorMsg
    ? `Error kind: ${kind}. Detail: ${errorMsg.slice(0, 500)}`
    : `Error kind: ${kind}`;

  switch (kind) {
    case "non_fast_forward":
      return {
        ...base,
        userSummary:
          "The online copy has new changes. Your work is saved — please sync again to combine everything.",
        recommendedNextStep: "Sync your project to combine your changes with the online version.",
        recommendedAction: "Sync now",
        recommendedActionKey: "sync",
        safeNextSteps: [
          "Your changes are saved on this computer and won't be lost.",
          "Syncing will combine your version and the online version automatically.",
        ],
        supportDetails,
      };

    case "merge_conflict":
      return {
        ...base,
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
        supportDetails,
      };

    case "binary_conflict":
      return {
        ...base,
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
        supportDetails,
      };

    case "auth_required":
      return {
        ...base,
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
        supportDetails,
      };

    case "network_unavailable":
      return {
        ...base,
        userSummary:
          "print-md couldn't reach the online repository. Check your connection and try again.",
        recommendedNextStep: "Check your internet connection and try syncing again.",
        recommendedAction: "Try again",
        recommendedActionKey: "sync",
        safeNextSteps: [
          "Your work is saved on this computer.",
          "Nothing was sent or changed online.",
        ],
        supportDetails,
      };

    case "detached_head":
      return {
        ...base,
        userSummary:
          "Your project's version history is in an unusual state and can't be synced right now.",
        recommendedNextStep:
          "Let print-md restore your project to a normal state so syncing works again.",
        recommendedAction: "Restore to normal",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your project will be saved before anything is changed.",
          "None of your content files will be removed or overwritten.",
        ],
        supportDetails,
      };

    case "stale_lock":
      return {
        ...base,
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
        supportDetails,
      };

    case "corrupt_index":
      return {
        ...base,
        userSummary:
          "The project's tracking information is damaged. print-md can rebuild it from your saved history.",
        recommendedNextStep:
          "Allow print-md to rebuild the tracking information from your version history.",
        recommendedAction: "Rebuild",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your project will be saved before anything is changed.",
          "Your content files and history are not affected.",
        ],
        supportDetails,
      };

    case "missing_git_dir":
      return {
        ...base,
        userSummary:
          "The version history for this project seems to be missing. print-md can try to recover it from the online copy.",
        recommendedNextStep:
          "Allow print-md to reconnect your project to its online version history.",
        recommendedAction: "Recover history",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your files will be saved first.",
          "Your content files will not be overwritten.",
          "If recovery isn't possible, your content is still intact.",
        ],
        supportDetails,
      };

    case "missing_or_corrupt_objects":
      return {
        ...base,
        userSummary:
          "Some saved history for this project appears to be missing or damaged.",
        recommendedNextStep:
          "Allow print-md to try fetching the missing history from the online copy.",
        recommendedAction: "Fetch missing history",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your project will be saved first.",
          "Your current content files are not at risk.",
          "If the missing history can't be restored, you'll see manual steps.",
        ],
        supportDetails,
      };

    case "unrelated_histories":
      return {
        ...base,
        userSummary:
          "This project and the online copy were created separately and don't share a starting point.",
        recommendedNextStep:
          "Let print-md combine your work with the online version into one project.",
        recommendedAction: "Combine projects",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "Your work will be saved in a safety copy before anything changes.",
          "Both your local changes and the online version will be kept.",
          "You may need to review a few files after combining.",
        ],
        supportDetails,
      };

    case "interrupted_rebase":
      return {
        ...base,
        userSummary:
          "Your project's last update didn't finish, so it can't be synced yet.",
        recommendedNextStep:
          "Let print-md undo the unfinished update and return your project to its last working state.",
        recommendedAction: "Restore to normal",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your project is saved before anything is changed.",
          "None of your content files are deleted.",
          "Any unfinished edits are kept in that safety copy so you can retrieve them.",
        ],
        // supportDetails is technical (behind a copy button) — it MUST name the
        // real state so support can act, unlike the jargon-free fields above.
        supportDetails: `Interrupted rebase detected. ${supportDetails}`,
      };

    case "interrupted_cherry_pick":
      return {
        ...base,
        userSummary:
          "Your project's last update didn't finish, so it can't be synced yet.",
        recommendedNextStep:
          "Let print-md undo the unfinished update and return your project to its last working state.",
        recommendedAction: "Restore to normal",
        recommendedActionKey: "restore_repo",
        safeNextSteps: [
          "A safety copy of your project is saved before anything is changed.",
          "None of your content files are deleted.",
          "Any unfinished edits are kept in that safety copy so you can retrieve them.",
        ],
        supportDetails: `Interrupted cherry-pick detected. ${supportDetails}`,
      };

    case "wrong_remote_or_branch":
      return {
        ...base,
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
        supportDetails,
      };

    default:
      return {
        ...base,
        userSummary:
          "Something unexpected went wrong while syncing. Your work is saved on this computer.",
        recommendedNextStep: "Try syncing again. If the problem continues, contact support.",
        recommendedAction: "Try again",
        recommendedActionKey: "open_log",
        safeNextSteps: [
          "Your work is saved on this computer.",
          "Nothing was changed online.",
        ],
        supportDetails,
      };
  }
}
