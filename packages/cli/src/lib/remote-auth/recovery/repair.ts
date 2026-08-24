/**
 * repair.ts — the ONE repair for a damaged repository.
 *
 * 2026-08-14 simplification (owner directive): replaces the 16-handler
 * recovery subsystem (dispatch/policy/backup-zip/confirm-gate/guidance).
 * Invariant, in priority order:
 *
 *   1. WORKING FILES ARE NEVER TOUCHED. Repair operates on `.git`; anything
 *      uncommitted is snapshotted, never overwritten or discarded.
 *   2. EVERY COMMIT THAT IS STILL READABLE STAYS REACHABLE. In-place fixes
 *      (which cannot lose history) run first; the last-resort re-clone
 *      salvages the old object store, and for a project with no online copy
 *      restores its branch refs on top. The damaged `.git` is kept on disk
 *      (`.git-damaged-<timestamp>`) as the final fallback.
 *   3. FULLY AUTOMATIC. No choices, no confirmation dialogs — nothing the
 *      pipeline does is destructive under invariants 1–2. (The CLI `repair`
 *      command adds its own terminal y/N in front; the desktop runs it
 *      silently behind the "Tidying up sync…" status.)
 *
 * Pipeline (ordered, cheapest/safest first):
 *
 *   a. Stale-lock sweep (locks.ts) — one fresh lock defers the whole repair
 *      with "retry_later" (a live process may hold the repo).
 *   b. Interrupted-operation cleanup — state files another git tool left
 *      behind (`MERGE_HEAD`, `rebase-merge/`, `CHERRY_PICK_HEAD`, …) are
 *      removed and the index is rebuilt from HEAD. Conflict markers that
 *      tool may have written into TRACKED FILES are left alone — under the
 *      converge model markers in a file are the normal representation of an
 *      unfinished combine, and the next snapshot simply records them.
 *   c. Index rebuild — an unreadable index is deleted and rebuilt from
 *      HEAD's tree via `git.resetIndex` (metadata only; never writes a
 *      working file, so uncommitted edits survive byte-for-byte).
 *   d. Detached-HEAD reattach — pending edits are committed where they
 *      stand, the commit is pinned by a `recovered-<stamp>` branch ref
 *      (isomorphic-git has no reflog — this ref IS the rescue), HEAD is
 *      reattached to the real branch, and the rescue tip is converge-merged
 *      back in so the stranded work lands in normal history.
 *   e. Re-clone with salvage (ONLY when the repo is still unreadable):
 *      move `.git` aside, clone a fresh `.git` from the remote (or
 *      `git init` when there is none), copy the damaged object store in
 *      additively, and snapshot the working files on top. When there was no
 *      remote to clone from, the damaged repo's branch refs are restored
 *      onto the fresh history so a local-only project keeps its versions.
 *
 * Pure isomorphic-git + node:fs (CLAUDE.md §7) — never the system git binary.
 */
import * as fs from "node:fs";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import git from "isomorphic-git";

import {
  gitDirFor,
  hasPendingChanges,
  isNoChangesError,
  resolveGitAuthor,
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../../source-provider.ts";
import { resolveLogger } from "../operation-log.ts";
import { convergeMerge } from "../converge-merge.ts";
import { repoDirFor, resolveTransport } from "../transport.ts";
import { cloneRepository } from "../clone.ts";
import { classifyFromHealth } from "./classify.ts";
import { inspectRepo } from "./inspect.ts";
import { sweepStaleLocks } from "./locks.ts";
import type { GitCache } from "../sync-types.ts";
import type { HostCredential, TokenStore } from "../token-store.ts";

export interface RepairOptions {
  projectDir: string;
  /** Explicit credential; wins over the token store (nuclear re-clone only). */
  credential?: HostCredential;
  /** Host-keyed store used to resolve the credential for the remote's host. */
  tokenStore?: TokenStore;
  authorName?: string;
  authorEmail?: string;
  /** Operation log (same file sync writes to). */
  logFile?: string;
}

export interface RepairResult {
  status: "repaired" | "retry_later" | "failed";
  /** One author-language sentence describing the outcome. */
  message: string;
  /** Author-language lines describing what was done (for the log/details). */
  actions: string[];
  /** Present when the re-clone ran: on-disk backup of the old `.git`. */
  damagedGitBackupPath?: string;
  /** Suggested delay before retrying (present on "retry_later"). */
  retryAfterMs?: number;
}

/** Transient state another git tool leaves behind mid-operation. */
const INTERRUPTED_STATE = [
  "MERGE_HEAD",
  "MERGE_MSG",
  "MERGE_MODE",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "sequencer",
  "rebase-merge",
  "rebase-apply",
] as const;

const MSG_REPAIRED = "Your project's version history is working again. Your files were not changed.";
const MSG_RETRY = "Another program may be using this project's history right now — try again in a moment.";
const MSG_FAILED =
  "Your project's history couldn't be repaired automatically, but your files are safe and untouched.";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** True when `.git/index` can be parsed. */
async function indexReadable(dir: string): Promise<boolean> {
  try {
    await git.listFiles({ fs, dir });
    return true;
  } catch {
    return false;
  }
}

/** Delete `.git/index` and rebuild it from HEAD's tree (metadata only). */
async function rebuildIndexFromHead(dir: string): Promise<void> {
  await rm(path.join(gitDirFor(dir), "index"), { force: true });
  // One cache for the whole rebuild — the tree walk plus one resetIndex per
  // tracked file would otherwise re-read the same packfiles.
  const cache: GitCache = {};
  let files: string[];
  try {
    files = await git.listFiles({ fs, dir, ref: "HEAD" });
  } catch {
    return; // unborn repo — an empty index is correct
  }
  for (const filepath of files) {
    // resetIndex updates ONLY the index entry (mode/oid/stat) — it does NOT
    // write to the working-tree file, so uncommitted edits survive.
    await git.resetIndex({ fs, dir, cache, filepath, ref: "HEAD" });
  }
}

/** Branch tips found in a (possibly damaged) `.git` — best-effort, never throws. */
function readDamagedBranchTips(damagedGitDir: string): Array<{ name: string; oid: string }> {
  const tips = new Map<string, string>();
  const OID = /^[0-9a-f]{40}$/;
  // packed-refs first (loose refs override below, matching git's precedence).
  try {
    const packed = fs.readFileSync(path.join(damagedGitDir, "packed-refs"), "utf8");
    for (const line of packed.split("\n")) {
      const m = /^([0-9a-f]{40}) refs\/heads\/(.+)$/.exec(line.trim());
      if (m) tips.set(m[2]!, m[1]!);
    }
  } catch {
    // no packed-refs — fine
  }
  const headsDir = path.join(damagedGitDir, "refs", "heads");
  const walk = (dir: string, prefix: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), name);
      else if (e.isFile()) {
        try {
          const oid = fs.readFileSync(path.join(dir, e.name), "utf8").trim();
          if (OID.test(oid)) tips.set(name, oid);
        } catch {
          // unreadable loose ref — skip
        }
      }
    }
  };
  walk(headsDir, "");
  return [...tips].map(([name, oid]) => ({ name, oid }));
}

/** The branch to reattach/repair onto: existing main/master, else first, else "main". */
async function targetBranch(dir: string): Promise<string> {
  try {
    const branches = await git.listBranches({ fs, dir });
    if (branches.includes("main")) return "main";
    if (branches.includes("master")) return "master";
    if (branches.length > 0) return branches[0]!;
  } catch {
    // fall through
  }
  return "main";
}

/**
 * Repair a damaged repository. See the module header for the pipeline and
 * invariants. Never throws for expected outcomes — everything is reported
 * through {@link RepairResult}.
 */
export async function repairRepo(options: RepairOptions): Promise<RepairResult> {
  const dir = await repoDirFor(options.projectDir);
  return withRepoLock(dir, () => repairLocked(dir, options));
}

async function repairLocked(dir: string, options: RepairOptions): Promise<RepairResult> {
  const logger = resolveLogger(options.logFile, "repair");
  const gitDir = gitDirFor(dir);
  const actions: string[] = [];

  const snapshotFiles = async (message: string): Promise<void> => {
    try {
      if (await hasPendingChanges(dir)) {
        await snapshotWorkingTreeUnlocked({
          projectDir: dir,
          repoRoot: dir,
          message,
          authorName: options.authorName,
          authorEmail: options.authorEmail,
        });
      }
    } catch (e) {
      if (!isNoChangesError(e)) throw e;
    }
  };

  try {
    // (a) Stale-lock sweep — a fresh lock defers the WHOLE repair.
    if (fs.existsSync(gitDir)) {
      const sweep = await sweepStaleLocks(gitDir);
      if (sweep === "fresh") {
        logger.info("repair", "fresh lock present — deferring");
        return { status: "retry_later", message: MSG_RETRY, actions, retryAfterMs: 30_000 };
      }
      if (sweep === "swept") {
        actions.push("Removed leftover lock files from an interrupted operation.");
        logger.info("repair", "swept stale locks");
      }
    }

    // (b) Interrupted-operation cleanup (state left by external git tools).
    if (fs.existsSync(gitDir)) {
      let removedState = false;
      for (const name of INTERRUPTED_STATE) {
        const p = path.join(gitDir, name);
        if (fs.existsSync(p)) {
          await rm(p, { recursive: true, force: true });
          removedState = true;
        }
      }
      if (removedState) {
        actions.push("Cleared an unfinished operation another program left behind.");
        logger.info("repair", "removed interrupted-operation state");
        // The abandoned operation usually leaves conflict-stage entries in
        // the index — rebuild it so the repo is consistent again.
        await rebuildIndexFromHead(dir);
      } else if (!(await indexReadable(dir))) {
        // (c) Index rebuild for a corrupt/unreadable index.
        await rebuildIndexFromHead(dir);
        actions.push("Rebuilt the project's tracking information.");
        logger.info("repair", "rebuilt corrupt index");
      }
    }

    // (d) Detached-HEAD reattach (only meaningful when the repo is readable).
    let health = await inspectRepo({ repoDir: dir }, { checkLocalChanges: false });
    if (health.hasGitDir && !health.headUnreadable && health.isDetachedHead) {
      // Pending edits first — they belong to the stranded point.
      await snapshotFiles("Saved your latest changes");
      const headOid = await git.resolveRef({ fs, dir, ref: "HEAD" });
      const rescueRef = `refs/heads/recovered-${stamp()}`;
      await git.writeRef({ fs, dir, ref: rescueRef, value: headOid, force: true });
      const branch = await targetBranch(dir);
      const branchExists = (await git.listBranches({ fs, dir })).includes(branch);
      if (!branchExists) {
        await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: headOid, force: true });
      }
      await git.writeRef({
        fs,
        dir,
        ref: "HEAD",
        value: `refs/heads/${branch}`,
        symbolic: true,
        force: true,
      });
      const cache: GitCache = {};
      await git.checkout({ fs, dir, cache, ref: branch, force: true });
      const branchTip = await git.resolveRef({ fs, dir, ref: branch });
      if (branchTip !== headOid) {
        // Fold the stranded work back into normal history — the rescue ref
        // stays as the pin either way (no reflog in isomorphic-git).
        await convergeMerge({
          dir,
          cache,
          branch,
          theirs: headOid,
          author: await resolveGitAuthor(dir, options.authorName, options.authorEmail),
          authorName: options.authorName,
          authorEmail: options.authorEmail,
          allowUnrelatedHistories: true,
        });
      }
      actions.push("Reconnected your work to the project's version line.");
      logger.info("repair", "reattached detached HEAD", { rescueRef });
    }

    // Re-inspect: if the repo is healthy now, the in-place fixes sufficed.
    health = await inspectRepo({ repoDir: dir }, { checkLocalChanges: false });
    if (classifyFromHealth(health, { minLockAgeMs: 0 }) === null) {
      await snapshotFiles("Saved your latest changes");
      logger.info("repair", "repaired in place", { actions: actions.length });
      return { status: "repaired", message: MSG_REPAIRED, actions };
    }

    // (e) Last resort: re-clone `.git` with salvage. Working files untouched.
    return await recloneWithSalvage(dir, options, actions, logger, snapshotFiles);
  } catch (e) {
    logger.error("repair", "repair failed", { error: e instanceof Error ? e.message : String(e) });
    return { status: "failed", message: MSG_FAILED, actions };
  }
}

async function recloneWithSalvage(
  dir: string,
  options: RepairOptions,
  actions: string[],
  logger: ReturnType<typeof resolveLogger>,
  snapshotFiles: (message: string) => Promise<void>,
): Promise<RepairResult> {
  const gitDir = gitDirFor(dir);

  // Resolve the remote BEFORE touching anything: if a remote is configured
  // but unreachable right now, defer instead of degrading to a fresh local
  // history while offline.
  let remoteUrl: string | undefined;
  let credential: HostCredential | undefined;
  try {
    const transport = await resolveTransport(dir, {
      credential: options.credential,
      tokenStore: options.tokenStore,
    });
    remoteUrl = transport.url;
    credential = transport.credential;
  } catch {
    remoteUrl = undefined; // no usable remote — fresh local history below
  }

  // Fresh `.git` first (into a temp dir), so the damaged one is only moved
  // aside AFTER a replacement actually exists.
  let freshGitDir: string;
  let tempDir: string | undefined;
  if (remoteUrl) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gutterpress-repair-"));
    const cloneDir = path.join(tempDir, "clone");
    try {
      await cloneRepository({
        url: remoteUrl,
        dir: cloneDir,
        ...(credential ? { credential } : {}),
      });
    } catch (e) {
      await rm(tempDir, { recursive: true, force: true });
      logger.warn("repair", "re-clone failed — deferring", {
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        status: "retry_later",
        message:
          "The online copy couldn't be reached to finish the repair. Your files are safe — it will be tried again.",
        actions,
        retryAfterMs: 60_000,
      };
    }
    freshGitDir = path.join(cloneDir, ".git");
  } else {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "gutterpress-repair-"));
    const initDir = path.join(tempDir, "init");
    fs.mkdirSync(initDir, { recursive: true });
    await git.init({ fs, dir: initDir, defaultBranch: "main" });
    freshGitDir = path.join(initDir, ".git");
  }

  // Swap: damaged `.git` → `.git-damaged-<stamp>` (the on-disk backup),
  // fresh `.git` in.
  let damagedBackup: string | undefined;
  if (fs.existsSync(gitDir)) {
    damagedBackup = path.join(dir, `.git-damaged-${stamp()}`);
    await rename(gitDir, damagedBackup);
    actions.push("Kept the old history folder on disk as a backup.");
  }
  await rename(freshGitDir, gitDir);
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  actions.push(
    remoteUrl
      ? "Rebuilt the project's history from the online copy."
      : "Started a fresh history for the project (no online copy is connected).",
  );
  logger.info("repair", "replaced .git", { fromRemote: Boolean(remoteUrl), damagedBackup });

  // Salvage: copy the damaged object store in ADDITIVELY (existing files are
  // never overwritten), then bring every old tip that still resolves back
  // into the repaired history.
  if (damagedBackup) {
    const from = path.join(damagedBackup, "objects");
    if (fs.existsSync(from)) {
      await cp(from, path.join(gitDir, "objects"), {
        recursive: true,
        force: false,
        errorOnExist: false,
      }).catch(() => {
        // Best-effort: a partially-readable store salvages what it can.
      });
    }

    // Local-only projects have no online copy to rebuild from, so the fresh
    // `.git` above is an empty `git init` — restore the damaged repo's branch
    // refs onto it so every commit whose objects survived stays reachable, and
    // reattach HEAD to the main branch among them. A re-clone from a remote
    // already HAS its branches: there the online copy is the history, and any
    // local commit it never saw stays readable in the `.git-damaged-` backup.
    const restored: string[] = [];
    if ((await git.listBranches({ fs, dir })).length === 0) {
      for (const tip of readDamagedBranchTips(damagedBackup)) {
        try {
          await git.readCommit({ fs, dir, cache: {}, oid: tip.oid });
        } catch {
          logger.warn("repair", "old tip unreadable — left in the backup", { tip: tip.name });
          continue;
        }
        await git.writeRef({
          fs,
          dir,
          ref: `refs/heads/${tip.name}`,
          value: tip.oid,
          force: true,
        });
        restored.push(tip.name);
      }
    }
    if (restored.length > 0) {
      // targetBranch now sees the restored refs (main/master, else the first).
      const branch = await targetBranch(dir);
      await git.writeRef({
        fs,
        dir,
        ref: "HEAD",
        value: `refs/heads/${branch}`,
        symbolic: true,
        force: true,
      });
      await rebuildIndexFromHead(dir);
      actions.push("Restored your saved history from the backup.");
      logger.info("repair", "restored branch refs from the backup", { branches: restored });
    }
  }

  // The working files were never touched — capture them on top so nothing on
  // disk is uncommitted after a repair.
  await snapshotFiles("Saved your files after repairing the project");

  return {
    status: "repaired",
    message: MSG_REPAIRED,
    actions,
    ...(damagedBackup ? { damagedGitBackupPath: damagedBackup } : {}),
  };
}
