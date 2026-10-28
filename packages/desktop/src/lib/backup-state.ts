/**
 * Book setup → Backup's states (#442): which of six situations a book is in,
 * read off `diagnoseProjectRemote`. ProjectConnectionsSection gives each one
 * headline and at most one next step.
 */
import type { ProjectRemoteDiagnosis, SyncOutcome, SyncStatus } from "./platform/contract";
import { relativeTime } from "./format";

export type BackupState =
  /** A plain folder: previous versions are off. */
  | "no-versions"
  /** Versions on, no online copy yet. */
  | "local-only"
  /** The online copy is on GitHub and GitHub is not connected. */
  | "connect-github"
  /** The online copy is on another https server with no saved access. */
  | "connect-server"
  /** Access to the online copy is set up (not proof that a backup worked: see `readyView`). */
  | "ready"
  /** An address Gutterpress can't back up over (SSH, or anything but https). */
  | "own-tools";

export function backupState(
  diag: Pick<ProjectRemoteDiagnosis, "classification" | "guidance" | "remoteUrl">,
): BackupState {
  if (diag.classification.type === "local-folder") return "no-versions";
  switch (diag.guidance) {
    case "connect-github-to-sync":
      return "connect-github";
    case "https-connect-server":
      return "connect-server";
    case "ready-to-sync":
      return "ready";
    case "ssh-use-own-tools":
      return "own-tools";
    case "local-only":
      // A remote that is neither https nor SSH (a folder path, git://).
      return diag.remoteUrl ? "own-tools" : "local-only";
  }
}

/** The online copy as people say it: `github.com/ada/harbor-lights` (no scheme, no `.git`). */
export function onlineCopyName(remoteUrl: string): string {
  return remoteUrl
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^@/]*@/, "")
    .replace(/(\.git)?\/?$/, "");
}

/** What is known about the book's last online backup: the host's last status, or a backup run from Backup. */
export type LastBackup = Pick<SyncStatus, "state" | "lastSyncAt" | "message">;

/** A backup run from Backup, in the status bar's vocabulary. */
export function backupFromOutcome(outcome: SyncOutcome, at: string): LastBackup {
  if (outcome.status === "synced" || outcome.status === "up-to-date") return { state: "synced", lastSyncAt: at };
  return { state: outcome.status, lastSyncAt: at, message: outcome.message };
}

export interface ReadyView {
  headline: string;
  detail: string;
  /** A backup is known to have worked, so the headline earns its check mark. */
  ok: boolean;
  /** The one thing to do: run a backup now, run it again after a failure, or sign in again. */
  action: "back-up" | "try-again" | "sign-in" | null;
}

/**
 * The "ready" situation's words. Access being set up is not a backup, so the
 * headline claims one only with evidence (a finished backup and its time) and
 * otherwise names the online copy.
 */
export function readyView(copy: string, last: LastBackup | null, autoSync: boolean, now: number): ReadyView {
  const ongoing = autoSync
    ? "Gutterpress backs it up while you work."
    : "Automatic backup is off, so this book is backed up only when you ask.";
  const manual = autoSync ? null : "back-up";
  switch (last?.state) {
    case "syncing":
      return { headline: `Backing up to ${copy}…`, detail: ongoing, ok: false, action: null };
    case "synced": {
      const at = Date.parse(last.lastSyncAt ?? "");
      if (Number.isNaN(at)) break;
      return { headline: `Backed up online to ${copy} · last backup ${relativeTime(at, now)}`, detail: ongoing, ok: true, action: manual };
    }
    case "offline":
      return { headline: `Couldn't back up to ${copy}: you're offline.`, detail: "Your work is saved on this computer.", ok: false, action: "try-again" };
    case "auth":
      return { headline: `Couldn't back up to ${copy}: it didn't accept the saved sign-in.`, detail: "Connect again to keep backing up.", ok: false, action: "sign-in" };
    case "error":
      return { headline: `Couldn't back up to ${copy}.`, detail: last.message || "Your work is saved on this computer.", ok: false, action: "try-again" };
  }
  return { headline: `Online copy: ${copy}`, detail: ongoing, ok: false, action: manual };
}
