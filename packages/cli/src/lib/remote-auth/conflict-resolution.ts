/**
 * Conflict-resolution orchestration (#15, ADR 0006 D5). Extracted from sync.ts:
 * {@link resolveConflicts} applies the author's per-file choices WITHOUT ever
 * materializing conflict markers — a custom isomorphic-git `mergeDriver` returns
 * the chosen side's content per decided file (replicating the default diff3
 * auto-merge for undecided files), producing an HONEST two-parent merge commit.
 * Delete-involved conflicts (deleted on one side, edited on the other) can't
 * reach the merge driver, so they are settled by small explicit commits around
 * the merge. The PURE decision table lives in resolution-plan.ts; this module
 * owns the git/fs side-effects of applying it, plus the push + race recovery.
 */
import * as fs from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";
// WHY diff3: this is the SAME tiny (~100-line, zero-dependency) module
// isomorphic-git's own default merge driver uses, so our "replicate the
// default auto-merge for undecided files" path behaves identically. It is
// unmaintained but stable and pinned to an EXACT version in package.json.
// If it ever breaks, inline the diff3 algorithm here (rule §5 inline-copy
// precedent) rather than swapping in a heavier diff library.
import diff3Merge from "diff3";

import {
  gitAuthor,
  hasPendingChanges,
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../source-provider.ts";
import { resolveLogger, shortOid } from "./operation-log.ts";
import { buildResolutionPlan } from "./resolution-plan.ts";
import { isMergeConflictError, isPushRejected } from "./recovery/classify.ts";
import {
  MSG_CONFLICT,
  MSG_EXPIRED_CHOICES,
  MSG_NO_BRANCH,
  MSG_NO_REMOTE,
  MSG_RACE,
  MSG_SSH_REMOTE,
  MSG_SYNCED_MERGED,
  SYNC_SNAPSHOT_MESSAGE,
} from "./sync-messages.ts";
import {
  conflictFilesFrom,
  currentBranchOrThrow,
  failureOutcome,
  fetchRemoteTip,
  onAuthFor,
  repoDirFor,
  resolveTransport,
} from "./transport.ts";
import type { GitCache, ResolveConflictsOptions, SyncOutcome } from "./sync-types.ts";

/**
 * `chapter-01.md` → `chapter-01 (online copy).md` (next to the original).
 * `counter` ≥ 2 produces `chapter-01 (online copy 2).md`, … — used to avoid
 * clobbering a pre-existing file with the same name.
 */
export function onlineCopyPath(filepath: string, counter?: number): string {
  const dirname = path.posix.dirname(filepath);
  const ext = path.posix.extname(filepath);
  const stem = path.posix.basename(filepath, ext);
  const label = counter && counter >= 2 ? `online copy ${counter}` : "online copy";
  const renamed = `${stem} (${label})${ext}`;
  return dirname === "." ? renamed : `${dirname}/${renamed}`;
}

/**
 * First "(online copy)" name that doesn't already exist in the working dir or
 * in either side's tree — a pre-existing file with that name must never be
 * overwritten by a "Keep both copies" resolution.
 */
async function uniqueOnlineCopyPath(
  dir: string,
  filepath: string,
  oids: string[],
  cache: GitCache,
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    if (fs.existsSync(path.join(dir, candidate))) return true;
    for (const oid of oids) {
      if ((await tryReadBlob(dir, oid, candidate, cache)) !== null) return true;
    }
    return false;
  };
  let candidate = onlineCopyPath(filepath);
  for (let n = 2; await taken(candidate); n++) {
    candidate = onlineCopyPath(filepath, n);
  }
  return candidate;
}

async function tryReadBlob(
  dir: string,
  oid: string,
  filepath: string,
  cache: GitCache,
): Promise<Uint8Array | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir, cache, oid, filepath });
    return blob;
  } catch {
    return null;
  }
}

/**
 * True when `oid` resolves to a real COMMIT object in this repo. Used to reject
 * well-formed-but-nonexistent ids (BUG 5) before any merge work — a stale id
 * from an expired conflict dialog must surface a friendly "run Sync again"
 * message, not an unhandled isomorphic-git throw. Reads the commit on the
 * caller's function-scoped cache (released with the operation).
 */
async function isRealCommit(
  dir: string,
  oid: string,
  cache: GitCache,
): Promise<boolean> {
  try {
    await git.readCommit({ fs, dir, cache, oid });
    return true;
  } catch {
    return false;
  }
}

/** Replicates isomorphic-git's default diff3 merge for UNDECIDED files. */
const LINEBREAKS = /^.*(\r?\n|$)/gm;
function defaultDiff3(
  baseContent: string,
  ourContent: string,
  theirContent: string,
): { cleanMerge: boolean; mergedText: string } {
  const result = diff3Merge(
    ourContent.match(LINEBREAKS) ?? [],
    baseContent.match(LINEBREAKS) ?? [],
    theirContent.match(LINEBREAKS) ?? [],
  );
  let mergedText = "";
  let cleanMerge = true;
  for (const item of result) {
    if (item.ok) mergedText += item.ok.join("");
    if (item.conflict) {
      // NEVER emit conflict markers: flag it unclean (the merge aborts and the
      // working tree stays exactly as it was) and keep our content as the
      // placeholder text — the written object is unreferenced and never
      // checked out.
      cleanMerge = false;
      mergedText += item.conflict.a.join("");
    }
  }
  return { cleanMerge, mergedText };
}

/**
 * Apply the author's per-file choices and sync the combined result
 * (ADR 0006 D5). The merge commit has TWO PARENTS — the local branch tip and
 * the online tip — so both histories remain intact and View History stays
 * honest about what was combined.
 *
 * How each choice is applied WITHOUT conflict markers:
 *
 * - Files edited in both copies are settled inside the merge itself by a
 *   custom `mergeDriver` that returns the chosen side's content ("Keep both
 *   copies" keeps mine and writes the online version to
 *   `<name> (online copy)<ext>` beforehand, committed on the local side so it
 *   is part of the merge). Undecided files auto-merge with the same diff3
 *   algorithm a plain merge uses.
 * - Delete-involved conflicts never reach a merge driver, so they are settled
 *   by equalizing the local side BEFORE the merge (making both sides agree so
 *   the merge is clean) and, when the author chose the now-removed side, a
 *   small follow-up commit AFTER the merge restores their choice. The merge
 *   commit still carries both parents; the around-commits are visible,
 *   honestly labeled steps in View History.
 */
export async function resolveConflicts(
  options: ResolveConflictsOptions,
): Promise<SyncOutcome> {
  const http = options.httpClient ?? httpNode;
  const logger = resolveLogger(options.logFile, "sync");
  logger.info("resolve", "starting conflict resolution", {
    files: options.resolutions.map((r) => `${r.path}:${r.choice}`),
    local: shortOid(options.localId),
    remote: shortOid(options.remoteId),
    allowUnrelated: options.allowUnrelatedHistories ?? false,
  });
  // Same repo-scope rules as syncProject: conflict resolution for a book
  // subfolder runs against the enclosing repository (conflict paths are
  // repo-root-relative), with the entry snapshot scoped to the book.
  const dir = await repoDirFor(options.projectDir);

  // Normalize both ids once at entry — every oid comparison below is lowercase.
  const normalizedLocalId = options.localId.toLowerCase();
  const normalizedRemoteId = options.remoteId.toLowerCase();
  if (
    !/^[0-9a-f]{40}$/.test(normalizedRemoteId) ||
    !/^[0-9a-f]{40}$/.test(normalizedLocalId)
  ) {
    return {
      status: "error",
      message: MSG_EXPIRED_CHOICES,
    };
  }

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // One object cache for this resolve operation only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);
      const author = gitAuthor(options.authorName, options.authorEmail);

      // Verify both ids are REAL commit objects in this repo before doing any
      // work (BUG 5). A well-formed-but-garbage hex id passes the regex above
      // but would later make isomorphic-git throw deep in the merge, producing
      // a generic "error" with no guidance. Read each commit up front; if
      // either is missing/expired, return the SAME friendly expired-choices
      // message as the regex-fail path — and nothing has been changed.
      const bothExist =
        (await isRealCommit(dir, normalizedLocalId, cache)) &&
        (await isRealCommit(dir, normalizedRemoteId, cache));
      if (!bothExist) {
        return { status: "error", message: MSG_EXPIRED_CHOICES };
      }

      // Safety: capture any edits (whole tree) made while the choices dialog
      // was open, before the merge's forced checkout can touch them.
      if (await hasPendingChanges(dir)) {
        const snap = await snapshotWorkingTreeUnlocked({
          projectDir: options.projectDir,
          repoRoot: dir,
          message: SYNC_SNAPSHOT_MESSAGE,
          authorName: options.authorName,
          authorEmail: options.authorEmail,
        });
        snapshotId = snap.id;
      }

      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const remoteId = normalizedRemoteId;

      // Build the per-file plan. "mine" is read from the CURRENT local tip
      // (not the stale localId) so edits made after the conflict was reported
      // count as the author's version. The decision table is a PURE function
      // (resolution-plan.ts) with the two blob reads injected; sync.ts owns the
      // git side-effects of applying the plan below.
      const { driverChoice, preWrites, preDeletes, postWrites, postDeletes, postBinaryFixes } =
        await buildResolutionPlan(options.resolutions, localTip, remoteId, {
          readBlob: (oid, filepath) => tryReadBlob(dir, oid, filepath, cache),
          uniqueOnlineCopyPath: (filepath, oids) =>
            uniqueOnlineCopyPath(dir, filepath, oids, cache),
        });

      const applyChanges = async (
        writes: Array<{ path: string; content: Uint8Array }>,
        deletes: string[],
        message: string,
      ): Promise<void> => {
        for (const w of writes) {
          const abs = path.join(dir, w.path);
          await mkdir(path.dirname(abs), { recursive: true });
          await writeFile(abs, w.content);
        }
        for (const d of deletes) {
          await unlink(path.join(dir, d)).catch(() => {});
        }
        if (await hasPendingChanges(dir)) {
          await snapshotWorkingTreeUnlocked({
            projectDir: dir,
            message,
            authorName: options.authorName,
            authorEmail: options.authorEmail,
          });
        }
      };

      // Pre-merge step: "(online copy)" files + delete-conflict equalization,
      // committed on the local side so the merge sees them.
      await applyChanges(
        preWrites,
        preDeletes,
        "Saved your choices for combining with the online version",
      );

      // The honest two-parent merge. The driver decides per-file; undecided
      // files auto-merge exactly like a normal merge (diff3). If anything is
      // STILL conflicted (an undecided file), the merge aborts untouched and
      // the remaining files go back to the author.
      try {
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteId,
          author,
          message: "Combined your changes with the online version",
          allowUnrelatedHistories: options.allowUnrelatedHistories ?? false,
          mergeDriver: ({ contents, path: filepath }) => {
            const base = contents[0] ?? "";
            const mine = contents[1] ?? "";
            const theirs = contents[2] ?? "";
            const choice = driverChoice.get(filepath);
            if (choice === "mine") return { cleanMerge: true, mergedText: mine };
            if (choice === "theirs") return { cleanMerge: true, mergedText: theirs };
            return defaultDiff3(base, mine, theirs);
          },
        });
      } catch (e) {
        if (isMergeConflictError(e)) {
          return {
            status: "conflict",
            message: MSG_CONFLICT,
            files: conflictFilesFrom(e.data),
            localId: await git.resolveRef({ fs, dir, ref: branch }),
            remoteId,
            ...(snapshotId ? { snapshotId } : {}),
          };
        }
        throw e;
      }
      // merge() moves the ref only — sync the working tree to the result.
      await git.checkout({ fs, dir, cache, ref: branch, force: true });

      // Binary safety: overwrite decided files with raw Uint8Array bytes from
      // the chosen side's git object (see postBinaryFixes comment above). For
      // text files this is a no-op (same bytes). For binary files this
      // corrects the UTF-8 corruption that the string-based merge driver
      // introduces. We write directly without creating a new commit here —
      // the bytes match the blob the merge commit already records (same oid),
      // so the working tree stays consistent with HEAD.
      for (const fix of postBinaryFixes) {
        const abs = path.join(dir, fix.path);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, fix.content);
      }

      // Post-merge step: restore the author's chosen side for delete-involved
      // files that had to be equalized the other way for the merge.
      await applyChanges(postWrites, postDeletes, "Applied your chosen versions");

      // Push, with ONE recovery pass: if someone synced between the
      // author's choices and this push, re-fetch the new online tip and
      // either merge it in cleanly and push again (no author interaction
      // needed) or hand back a FRESH conflict carrying the NEW tip — the UI
      // re-renders the choices screen from a conflict outcome, so the author
      // never sees a dead-end "try again" for a resolvable race.
      const doPush = () =>
        git.push({
          fs,
          http,
          dir,
          cache,
          remote: transport.remote,
          ref: branch,
          ...onAuthFor(transport.credential),
        });
      try {
        await doPush();
      } catch (e) {
        if (!isPushRejected(e)) throw e;
        const newRemoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
        if (!newRemoteTip) {
          return {
            status: "error",
            message: MSG_RACE,
            ...(snapshotId ? { snapshotId } : {}),
          };
        }
        try {
          await git.merge({
            fs,
            dir,
            cache,
            ours: branch,
            theirs: newRemoteTip,
            author,
            message: "Combined your changes with the online version",
          });
        } catch (mergeErr) {
          if (isMergeConflictError(mergeErr)) {
            // Still conflicted against the NEW online tip: a fresh conflict
            // outcome (new remoteId) so the next confirm targets reality.
            return {
              status: "conflict",
              message: MSG_CONFLICT,
              files: conflictFilesFrom(mergeErr.data),
              localId: await git.resolveRef({ fs, dir, ref: branch }),
              remoteId: newRemoteTip,
              ...(snapshotId ? { snapshotId } : {}),
            };
          }
          throw mergeErr;
        }
        await git.checkout({ fs, dir, cache, ref: branch, force: true });
        try {
          await doPush();
        } catch (retryErr) {
          if (isPushRejected(retryErr)) {
            return {
              status: "error",
              message: MSG_RACE,
              ...(snapshotId ? { snapshotId } : {}),
            };
          }
          throw retryErr;
        }
      }

      return {
        status: "synced",
        message: MSG_SYNCED_MERGED,
        mergedRemoteChanges: true,
        ...(snapshotId ? { snapshotId } : {}),
      };
    } catch (e) {
      if (
        e instanceof Error &&
        (e.message === MSG_NO_REMOTE ||
          e.message === MSG_SSH_REMOTE ||
          e.message === MSG_NO_BRANCH)
      ) {
        logger.error("resolve", `setup error`, { error: e.message });
        return { status: "error", message: e.message, ...(snapshotId ? { snapshotId } : {}) };
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("resolve", `unexpected error`, { error: errMsg });
      return failureOutcome(e, snapshotId);
    }
  });
}
