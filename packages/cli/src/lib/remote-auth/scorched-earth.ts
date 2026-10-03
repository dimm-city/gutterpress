/**
 * Scorched earth — the last-resort reset for a book folder whose Git state is
 * beyond {@link repairOnlineBackup}. Four fixed steps:
 *
 *   1. copy the whole folder (its `.git` included) to `backupDir`
 *   2. delete everything inside the folder
 *   3. download a fresh copy from the online address into the now-empty folder
 *   4. copy the backup's files (NOT its `.git` — that is the broken part) back
 *      on top of the fresh copy
 *
 * The files on this computer win; files only the online copy has stay. Nothing
 * is saved or backed up afterwards — the result is the fresh history plus the
 * author's files as unsaved changes, which the normal save/back-up picks up.
 * The backup in `backupDir` is never deleted.
 */
import { gitFs as fs } from "../git-fs.ts";
import git from "isomorphic-git";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { withRepoLock } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { errorLogData, resolveLogger } from "./operation-log.ts";
import type { SyncProjectOptions } from "./sync-types.ts";
import { repoDirFor, resolveTransport } from "./transport.ts";

export interface ScorchedEarthOptions
  extends Pick<SyncProjectOptions, "projectDir" | "credential" | "tokenStore" | "logFile" | "httpClient"> {
  /** Where the full copy of the folder goes — OUTSIDE the folder. Kept indefinitely. */
  backupDir: string;
}

export interface ScorchedEarthResult {
  /** The folder that was reset (the repo root of `projectDir`). */
  dir: string;
  /** Where the full copy of the folder (old `.git` included) was kept. */
  backupDir: string;
  /** The branch the fresh copy has checked out. */
  branch?: string;
}

async function emptyDir(dir: string): Promise<void> {
  for (const entry of await readdir(dir)) {
    await rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

/** Copy `from`'s contents onto `to`, skipping `from/.git`. */
async function copyFilesBack(from: string, to: string): Promise<void> {
  const skip = path.join(from, ".git");
  for (const entry of await readdir(from)) {
    const src = path.join(from, entry);
    if (src === skip) continue;
    await cp(src, path.join(to, entry), { recursive: true, force: true });
  }
}

export async function scorchedEarth(options: ScorchedEarthOptions): Promise<ScorchedEarthResult> {
  const logger = resolveLogger(options.logFile, "scorched-earth");
  const dir = await repoDirFor(options.projectDir);
  const backupDir = options.backupDir;
  try {
    // Steps 1–2 under the repo lock. cloneRepository takes the same
    // (non-reentrant) lock itself, so step 3 runs after it is released.
    const { transport, branch } = await withRepoLock(dir, async () => {
      // Needs only `.git/config` (the online address), which survives most damage.
      const transport = await resolveTransport(dir, options);
      let branch: string | undefined;
      try {
        branch = (await git.currentBranch({ fs, dir })) ?? undefined;
      } catch {
        branch = undefined; // unreadable HEAD: take the online default branch
      }
      logger.info("backup", "copying folder", { to: backupDir });
      await mkdir(backupDir, { recursive: true });
      await cp(dir, backupDir, { recursive: true });
      logger.info("delete", "emptying folder", { dir });
      await emptyDir(dir);
      return { transport, branch };
    });

    let fresh: Awaited<ReturnType<typeof cloneRepository>>;
    try {
      logger.info("download", "starting", { remote: transport.remote, branch: branch ?? "default" });
      fresh = await cloneRepository({
        url: transport.url,
        dir,
        ...(transport.credential ? { credential: transport.credential } : {}),
        ...(branch ? { branch } : {}),
        tokenStore: options.tokenStore,
        httpClient: options.httpClient,
      });
    } catch (e) {
      // Never leave the author with an empty folder: put everything back.
      logger.warn("download", "failed — restoring the folder from the backup", errorLogData(e));
      await emptyDir(dir);
      await cp(backupDir, dir, { recursive: true });
      throw e;
    }

    await withRepoLock(dir, () => copyFilesBack(backupDir, dir));
    logger.info("result", "scorched earth complete", { branch: fresh.branch });
    return { dir, backupDir, ...(fresh.branch ? { branch: fresh.branch } : {}) };
  } catch (e) {
    logger.error("scorched-earth", "failed", errorLogData(e));
    throw e;
  }
}
