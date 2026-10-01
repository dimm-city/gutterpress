/**
 * Repair online backup — the ONE recovery for a book whose `.git` no longer
 * works with its online copy (a damaged object or index, a lost branch, "no
 * history in common", an interrupted merge). One fixed sequence, no diagnosis:
 * download the online history, move the old `.git` aside (kept), put the fresh
 * one in place, bring back files that exist only online, then save a version
 * and back up. It works because the author's files are never inside `.git`
 * and the online copy is the authoritative history.
 *
 * Policy, stated in the dialog that offers the button: the files on this
 * computer win. A file also changed online since this computer last synced
 * stays in the version history, but there is no three-way merge — the broken
 * history is exactly the common base a merge would need.
 */
import { gitFs as fs } from "../git-fs.ts";
import git from "isomorphic-git";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import { withRepoLock } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { errorLogData, resolveLogger } from "./operation-log.ts";
import { syncProject } from "./sync.ts";
import type { SyncOutcome, SyncProjectOptions } from "./sync-types.ts";
import { repoDirFor, resolveTransport } from "./transport.ts";

/** Message recorded on the version a repair saves. */
export const REPAIR_SNAPSHOT_MESSAGE = "Repaired online backup";

export interface RepairOnlineBackupOptions
  extends Pick<
    SyncProjectOptions,
    "projectDir" | "credential" | "tokenStore" | "authorName" | "authorEmail" | "logFile" | "httpClient"
  > {
  /**
   * Where the old `.git` and the fresh download go — chosen by the host,
   * OUTSIDE the book (a folder inside it would be committed). Created if
   * missing; the old history is kept at `<backupDir>/git` indefinitely.
   */
  backupDir: string;
}

export interface RepairOnlineBackupResult {
  /** The closing sync: "synced" / "up-to-date" when the repair worked. */
  outcome: SyncOutcome;
  /** Where the old `.git` was moved to. */
  movedGitTo: string;
  /** Files that existed online but not on this computer, restored from the download. */
  restoredFiles: string[];
}

/** Move a directory, falling back to copy + delete across devices (EXDEV). */
async function moveDir(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await cp(from, to, { recursive: true });
    await rm(from, { recursive: true, force: true });
  }
}

export async function repairOnlineBackup(
  options: RepairOnlineBackupOptions,
): Promise<RepairOnlineBackupResult> {
  const logger = resolveLogger(options.logFile, "repair");
  const dir = await repoDirFor(options.projectDir);
  const oldGit = path.join(dir, ".git");
  const movedGitTo = path.join(options.backupDir, "git");
  const freshDir = path.join(options.backupDir, "fresh-clone");

  const { restoredFiles, credential } = await withRepoLock(dir, async () => {
    // Needs only `.git/config` (the online address), which survives most damage.
    const transport = await resolveTransport(dir, options);
    let branch: string | undefined;
    try {
      branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    } catch {
      branch = undefined; // unreadable HEAD: take the online default branch
    }
    logger.info("download", "starting", { remote: transport.remote, branch: branch ?? "default" });
    const fresh = await cloneRepository({
      url: transport.url,
      dir: freshDir,
      ...(transport.credential ? { credential: transport.credential } : {}),
      ...(branch ? { branch } : {}),
      // A sign-in that lived only inside the old address is migrated into the
      // store here, so the closing backup below still has it.
      tokenStore: options.tokenStore,
      httpClient: options.httpClient,
    });

    logger.info("swap", "moving old history aside", { to: movedGitTo });
    await moveDir(oldGit, movedGitTo);
    try {
      await moveDir(path.join(freshDir, ".git"), oldGit);
    } catch (e) {
      // Never leave the book with no (or half a) `.git`: put the old one back.
      await rm(oldGit, { recursive: true, force: true });
      await moveDir(movedGitTo, oldGit);
      throw e;
    }
    await rm(freshDir, { recursive: true, force: true });

    // Edit-beats-delete: files only the online copy has come back; every file
    // here stays as it is. The swap is done, so a restore that fails (a name
    // this OS can't write) is logged and the backup still runs.
    const ref = fresh.branch ?? "HEAD";
    let missing: string[] = [];
    try {
      const tracked = await git.listFiles({ fs, dir, ref });
      missing = tracked.filter((f) => !fs.existsSync(path.join(dir, f)));
      if (missing.length > 0) {
        await git.checkout({ fs, dir, ref, filepaths: missing, force: true });
        logger.info("restore", "restored files missing on this computer", { files: missing });
      }
    } catch (e) {
      logger.warn("restore", "could not restore every online-only file", errorLogData(e));
      missing = [];
    }
    return { restoredFiles: missing, credential: transport.credential };
  }).catch((e) => {
    logger.error("repair", "repair failed", errorLogData(e));
    throw e;
  });

  // Outside the lock: syncProject takes it itself.
  const outcome = await syncProject({
    projectDir: options.projectDir,
    credential,
    tokenStore: options.tokenStore,
    authorName: options.authorName,
    authorEmail: options.authorEmail,
    logFile: options.logFile,
    httpClient: options.httpClient,
    message: REPAIR_SNAPSHOT_MESSAGE,
    push: true,
  });
  logger.info("result", "repair complete", { status: outcome.status, restored: restoredFiles.length });
  return { outcome, movedGitTo, restoredFiles };
}
