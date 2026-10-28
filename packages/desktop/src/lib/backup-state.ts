/**
 * Book setup → Backup's states (#442): which of six situations a book is in,
 * read off `diagnoseProjectRemote`. ProjectConnectionsSection gives each one
 * headline and at most one next step.
 */
import type { ProjectRemoteDiagnosis } from "#lib/platform/contract.ts";

export type BackupState =
  /** A plain folder: previous versions are off. */
  | "no-versions"
  /** Versions on, no online copy yet. */
  | "local-only"
  /** The online copy is on GitHub and GitHub is not connected. */
  | "connect-github"
  /** The online copy is on another https server with no saved access. */
  | "connect-server"
  /** Backing up works. */
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
