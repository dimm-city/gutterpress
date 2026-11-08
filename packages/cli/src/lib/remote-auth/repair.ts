/**
 * Repair the online copy — the ONE recovery for a book whose `.git` no longer
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
import { cp, mkdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { BEFORE_REPAIR_REF_PREFIX, readRevisionRefs, withRepoLock } from "../source-provider.ts";
import { cloneRepository } from "./clone.ts";
import { defaultGitHttp } from "./git-http.ts";
import { errorLogData, resolveLogger } from "./operation-log.ts";
import { refreshRemoteCopies, syncProject } from "./sync.ts";
import type { HostCredential, TokenStore } from "./token-store.ts";
import type { SyncOutcome, SyncProjectOptions } from "./sync-types.ts";
import { repoDirFor, resolveTransport, serverTip } from "./transport.ts";

/** Message recorded on the version a repair saves (older history says "Repaired online backup"). */
export const REPAIR_SNAPSHOT_MESSAGE = "Repaired the online copy";

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

/** What a repair would set aside: work that exists only on this computer. */
export interface RepairPreview {
  /** Revisions kept only on this computer, by name. */
  revisions: string[];
  /** Versions (saved points) found only on this computer, across every revision. */
  versions: number;
  /** Saved copies of the book kept by an earlier recovery (set aside with the old history, so no longer listed in the app; counted in `versions`). */
  repairCopies?: number;
  /** True when this computer's history could not be read, so the counts may be short. */
  unreadable?: boolean;
}

/** Longest history walk per revision when counting what is only here. */
const PREVIEW_DEPTH = 2000;

/**
 * Before the author confirms a repair: what would it set aside? A repair moves
 * the whole old history (`.git`) into a backup folder OUTSIDE the book and
 * starts from the online one, so any revision, and any version of a revision,
 * the online copy lacks is what would be left out of the book. It is kept in
 * that folder (`movedGitTo` in the repair result) to look at, but it does NOT
 * appear under "Saved copies after a repair" and can't be brought back from
 * inside the app; the same goes for earlier before-repair copies, which travel
 * with the old history. Reads refs and history on this computer only (the
 * online side is as of a refresh made first when the caller can sign in, which
 * updates remote-tracking refs only: it fetches, but changes no version, file or
 * local revision).
 */
export async function previewRepair(
  projectDir: string,
  options: { tokenStore?: TokenStore; credential?: HostCredential; httpClient?: RepairOnlineBackupOptions["httpClient"] } = {},
): Promise<RepairPreview> {
  const dir = await repoDirFor(projectDir);
  // Bring what is known of the online copy up to date when that is cheap (a
  // recent check is reused; any failure leaves the refs as they were).
  if (options.tokenStore || options.credential) {
    await refreshRemoteCopies({ projectDir, ...options, maxAgeMs: 60_000 }).catch(() => null);
  }
  try {
    const { local, online } = await readRevisionRefs(dir);
    const walk = async (tip: string) =>
      (await git.log({ fs, dir, ref: tip, depth: PREVIEW_DEPTH })).map((c) => c.oid);
    const onlineSet = new Set<string>();
    for (const tip of online.values()) for (const oid of await walk(tip)) onlineSet.add(oid);
    const onlyHere = new Set<string>();
    for (const tip of local.values()) {
      for (const oid of await walk(tip)) if (!onlineSet.has(oid)) onlyHere.add(oid);
    }
    // Copies an earlier recovery kept (refs/gutterpress/before-repair-*) live in the old history too.
    const copies = (await git.listRefs({ fs, dir, filepath: "refs/gutterpress" }).catch(() => [] as string[])).filter(
      (r) => `refs/gutterpress/${r}`.startsWith(BEFORE_REPAIR_REF_PREFIX),
    );
    for (const r of copies) {
      const tip = await git.resolveRef({ fs, dir, ref: `refs/gutterpress/${r}` }).catch(() => null);
      if (tip) for (const oid of await walk(tip)) if (!onlineSet.has(oid)) onlyHere.add(oid);
    }
    const revisions = [...local.keys()].filter((name) => !online.has(name)).sort((a, b) => a.localeCompare(b));
    return { revisions, versions: onlyHere.size, ...(copies.length ? { repairCopies: copies.length } : {}) };
  } catch (e) {
    resolveLogger(undefined, "repair").warn("preview", "could not read this computer's history", errorLogData(e));
    return { revisions: [], versions: 0, unreadable: true };
  }
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
  // Remember whether the folder was already there: a failed repair removes only what this call made.
  const backupDirExisted = fs.existsSync(options.backupDir);

  const { restoredFiles, credential } = await withRepoLock(dir, async () => {
    // Needs only `.git/config` (the online address), which survives most damage.
    const transport = await resolveTransport(dir, options);
    let branch: string | undefined;
    try {
      branch = (await git.currentBranch({ fs, dir })) ?? undefined;
    } catch {
      branch = undefined; // unreadable HEAD: take the online default branch
    }
    // A draft that exists only on this computer can't be downloaded: take the
    // online default branch instead (the draft's history goes aside with the old
    // history); after the swap the book is put back on a local branch of that name.
    let onlyHereDraft: string | undefined;
    if (branch) {
      const online = await serverTip(transport, branch, options.httpClient ?? defaultGitHttp).catch(() => branch);
      if (!online) {
        onlyHereDraft = branch;
        branch = undefined;
      }
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

    // The draft that was only here stays the current draft, at the fresh tip: the
    // files on top then close-sync as that draft (published online) and the online
    // default branch is left alone.
    if (onlyHereDraft) {
      try {
        await git.branch({ fs, dir, ref: onlyHereDraft, checkout: true });
      } catch (e) {
        logger.warn("swap", "could not keep the current draft's name", errorLogData(e));
      }
    }

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
  }).catch(async (e) => {
    logger.error("repair", "repair failed", errorLogData(e));
    // Remove only what this call made: the fresh download, then the (empty) folder
    // itself if it wasn't there before. Never recursive on the folder: it may hold other things.
    if (!fs.existsSync(movedGitTo)) {
      await rm(freshDir, { recursive: true, force: true }).catch(() => {});
      if (!backupDirExisted) await rmdir(options.backupDir).catch(() => {});
    }
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
