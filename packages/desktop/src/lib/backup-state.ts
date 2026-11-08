/**
 * Book setup → Online copy's states (#442): which of six situations a book is
 * in, read off `diagnoseProjectRemote`. ProjectConnectionsSection gives each
 * one headline and at most one next step.
 */
import type { ProjectRemoteDiagnosis, SyncStatus } from "./platform/contract";
import { relativeTime } from "./format";

export type BackupState =
  /** A plain folder: version history is off. */
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

/** What is known about the book's last backing up: the host's last status, or a backup run from Online copy. */
export type LastBackup = Pick<SyncStatus, "lastSyncAt" | "message"> & {
  /** The host's ambient state, plus `not-found` (the online copy's address leads nowhere). */
  state: SyncStatus["state"] | "not-found";
  /** Versions on this computer the online copy lacks, when the host counted. */
  ahead?: number;
  /** The online copy has changes this computer lacks, when the host checked. */
  behind?: boolean;
  /** Passages with two takes, when the host counted. */
  decide?: number;
  /** From this computer's own records only; the network has not confirmed it yet. */
  local?: boolean;
  /** The host's machine-readable cause for an error (`not-found`). */
  reason?: string;
  /** `github` when the online copy is on GitHub. */
  host?: string;
};

export interface ReadyView {
  headline: string;
  detail: string;
  /** A backup is known to have worked, so the headline earns its check mark. */
  ok: boolean;
  /**
   * The one thing to do: back up now, run it again after a failure, or sign in again (nothing
   * while a pass runs). Backing up now is one pass that gets the latest changes, then backs up
   * yours, whatever "Back up online automatically" says (#485); Online copy names it Sync now
   * while that is off. Get latest, which sends nothing, sits beside it and beside Try again.
   */
  action: "back-up" | "try-again" | "sign-in" | null;
}

/**
 * The "ready" situation's words. Access being set up is not a backup, so the
 * headline claims one only with evidence (a finished pass that sent your work,
 * and its time) and otherwise names the online copy.
 */
export function readyView(copy: string, last: LastBackup | null, autoSync: boolean, now: number): ReadyView {
  const ongoing = autoSync
    ? "Gutterpress sends it online while you work."
    : "Sending automatically is off, so this book gets the latest changes and sends yours only when you ask.";
  switch (last?.state) {
    case "syncing":
      return { headline: `Sending to ${copy}…`, detail: ongoing, ok: false, action: null };
    case "synced": {
      const at = Date.parse(last.lastSyncAt ?? "");
      if (Number.isNaN(at)) break;
      return { headline: `Saved online · ${relativeTime(at, now)}`, detail: ongoing, ok: true, action: "back-up" };
    }
    case "unsent":
      return { headline: "Not online yet", detail: ongoing, ok: false, action: "back-up" };
    case "offline":
      return { headline: `Couldn't reach ${copy}.`, detail: "Check your internet connection, or try again later. Your work is saved on this computer.", ok: false, action: "try-again" };
    case "auth":
      return { headline: `Couldn't send to ${copy}: it didn't accept the saved sign-in.`, detail: "Sign in again to keep sending changes.", ok: false, action: "sign-in" };
    case "error":
      return { headline: `Couldn't send to ${copy}.`, detail: last.message || "Your work is saved on this computer.", ok: false, action: "try-again" };
  }
  return { headline: `Online copy: ${copy}`, detail: ongoing, ok: false, action: "back-up" };
}
