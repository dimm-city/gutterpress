/**
 * Repair online backup — the ONE recovery for a book whose `.git` no longer
 * works with its online copy (a damaged object or index, a lost branch, "no
 * history in common", an interrupted merge). Deliberately one fixed sequence
 * with no diagnosis and no branching: the author's files are never inside
 * `.git`, and the online copy is the authoritative history, so a clean history
 * can always be downloaded again and the files on this computer laid over it.
 *
 *   1. Download a fresh copy of the online history (into `backupDir`, so a
 *      network failure here touches nothing in the book).
 *   2. Move the book's old `.git` aside into `backupDir` — kept, never deleted.
 *   3. Put the fresh `.git` in place. The author's files are untouched.
 *   4. Restore any file that exists online but not on this computer — the same
 *      edit-beats-delete rule sync already follows, so a chapter added on
 *      another machine is never deleted by a repair.
 *   5. Save a version and back up (an ordinary `syncProject`).
 *
 * Policy, stated in the dialog that offers the button: the files on this
 * computer win. A file also changed online since this computer last synced is
 * not lost — it stays in the version history — but there is no three-way
 * merge, because the broken history is exactly the common base a merge needs.
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

  let usedCredential: RepairOnlineBackupOptions["credential"];
  const restoredFiles = await withRepoLock(dir, async () => {
    // Reads only `.git/config`, which survives most damage; a book whose
    // config is gone too has no online address, and nothing here can invent one.
    const transport = await resolveTransport(dir, options);
    usedCredential = transport.credential;
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

    // Edit-beats-delete: a file the online copy has and this computer lacks
    // comes back from the download; every file here stays exactly as it is.
    // The swap is done by now, so a restore that fails (an unwritable name on
    // this OS) is logged and the repair carries on to the backup.
    const ref = fresh.branch ?? "HEAD";
    try {
      const tracked = await git.listFiles({ fs, dir, ref });
      const missing = tracked.filter((f) => !fs.existsSync(path.join(dir, f)));
      if (missing.length > 0) {
        await git.checkout({ fs, dir, ref, filepaths: missing, force: true });
        logger.info("restore", "restored files missing on this computer", { files: missing });
      }
      return missing;
    } catch (e) {
      logger.warn("restore", "could not restore every online-only file", errorLogData(e));
      return [];
    }
  }).catch((e) => {
    logger.error("repair", "repair failed", errorLogData(e));
    throw e;
  });

  // Outside the lock: syncProject takes it itself. With no store, the
  // credential resolved from the old address is the only one there is.
  const outcome = await syncProject({
    projectDir: options.projectDir,
    credential: options.credential ?? (options.tokenStore ? undefined : usedCredential),
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
