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
import type { MergeDriverCallback } from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";
import { defaultGitHttp } from "./git-http.ts";
// WHY diff3: this is the SAME tiny (~100-line, zero-dependency) module
// isomorphic-git's own default merge driver uses, so our "replicate the
// default auto-merge for undecided files" path behaves identically. It is
// unmaintained but stable and pinned to an EXACT version in package.json.
// If it ever breaks, inline the diff3 algorithm here (rule §5 inline-copy
// precedent) rather than swapping in a heavier diff library.
import diff3Merge from "diff3";

import {
  resolveGitAuthor,
  hasPendingChanges,
  snapshotWorkingTreeUnlocked,
  withRepoLock,
} from "../source-provider.ts";
import { resolveLogger, shortOid } from "./operation-log.ts";
import { buildResolutionPlan } from "./resolution-plan.ts";
import type { PlanWrite, ResolutionPlan } from "./resolution-plan.ts";
import { isMergeConflictError, isPushRejected } from "./recovery/classify.ts";
import {
  MSG_CONFLICT,
  MSG_EXPIRED_CHOICES,
  MSG_RACE,
  MSG_SYNCED_MERGED,
  SYNC_SNAPSHOT_MESSAGE,
} from "./sync-messages.ts";
import {
  assertNoStructuralDamage,
  conflictFilesFrom,
  currentBranchOrThrow,
  failureOutcome,
  fetchRemoteTip,
  onAuthFor,
  repoDirFor,
  resolveTransport,
  setupErrorMessage,
} from "./transport.ts";
import type {
  GitCache,
  RemoteTransport,
  ResolveConflictsOptions,
  SyncOutcome,
} from "./sync-types.ts";

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

/** Byte equality for two blobs (never decoded through a string). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * First "(online copy)" name that is SAFE for `content`: a name whose every
 * existing occurrence (working dir, either side's tree) is byte-identical to
 * `content` — or that doesn't exist at all. A pre-existing file with that name
 * and DIFFERENT bytes must never be overwritten by a "Keep both copies"
 * resolution, so the counter bumps past it.
 *
 * The identical-bytes reuse makes retries idempotent: a failed resolution
 * (e.g. the push raced and the author confirms again) finds its own
 * "(online copy)" file from the previous attempt and reuses it instead of
 * committing "(online copy 2)", "(online copy 3)", … on every retry — the
 * accumulation defect from the 2026-08 field incident.
 */
async function uniqueOnlineCopyPath(
  dir: string,
  filepath: string,
  oids: string[],
  content: Uint8Array,
  cache: GitCache,
): Promise<string> {
  const taken = async (candidate: string): Promise<boolean> => {
    const abs = path.join(dir, candidate);
    if (fs.existsSync(abs) && !bytesEqual(fs.readFileSync(abs), content)) {
      return true;
    }
    for (const oid of oids) {
      const blob = await tryReadBlob(dir, oid, candidate, cache);
      if (blob !== null && !bytesEqual(blob, content)) return true;
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

type GitAuthor = { name: string; email: string };
type ConflictOutcome = Extract<SyncOutcome, { status: "conflict" }>;

/**
 * Perform ONE honest two-parent merge of `theirs` into `branch` and sync the
 * working tree to the result — the merge + checkout + conflict-mapping step run
 * BOTH for the initial driver merge and the push-race recovery merge. On a
 * merge conflict (an undecided file) the merge aborts untouched and this returns
 * a `conflict` outcome carrying `theirs` as the new remoteId so the caller bails
 * and the UI re-renders the choices screen; otherwise it checks out the merged
 * ref and returns null. The only per-call differences — the custom
 * `mergeDriver` and `allowUnrelatedHistories` — are optional params.
 */
async function commitHonestMerge(params: {
  dir: string;
  cache: GitCache;
  branch: string;
  theirs: string;
  author: GitAuthor;
  snapshotId: string | undefined;
  allowUnrelatedHistories?: boolean;
  mergeDriver?: MergeDriverCallback;
}): Promise<ConflictOutcome | null> {
  const { dir, cache, branch, theirs, author, snapshotId } = params;
  try {
    await git.merge({
      fs,
      dir,
      cache,
      ours: branch,
      theirs,
      author,
      message: "Combined your changes with the online version",
      allowUnrelatedHistories: params.allowUnrelatedHistories ?? false,
      ...(params.mergeDriver ? { mergeDriver: params.mergeDriver } : {}),
    });
  } catch (e) {
    if (isMergeConflictError(e)) {
      return {
        status: "conflict",
        message: MSG_CONFLICT,
        files: conflictFilesFrom(e.data),
        localId: await git.resolveRef({ fs, dir, ref: branch }),
        remoteId: theirs,
        ...(snapshotId ? { snapshotId } : {}),
      };
    }
    throw e;
  }
  // merge() moves the ref only — sync the working tree to the result.
  await git.checkout({ fs, dir, cache, ref: branch, force: true });
  return null;
}

/**
 * Apply a built {@link ResolutionPlan} to the working tree and settle it into an
 * honest two-parent merge (ADR 0006 D5) WITHOUT ever materializing conflict
 * markers. Order: pre-merge equalization commit → driver merge + checkout →
 * binary-safety byte fixes → post-merge restore commit. Returns a `conflict`
 * outcome when an undecided file still conflicts (the merge aborts untouched);
 * otherwise null once the merged result is on disk.
 */
async function applyPlan(params: {
  dir: string;
  cache: GitCache;
  branch: string;
  author: GitAuthor;
  authorName?: string;
  authorEmail?: string;
  plan: ResolutionPlan;
  remoteId: string;
  allowUnrelatedHistories: boolean;
  snapshotId: string | undefined;
}): Promise<ConflictOutcome | null> {
  const { dir, cache, branch, author, plan, remoteId, snapshotId } = params;

  const applyChanges = async (
    writes: PlanWrite[],
    deletes: string[],
    message: string,
  ): Promise<void> => {
    for (const w of writes) {
      const abs = path.join(dir, w.path);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, w.content);
    }
    for (const d of deletes) {
      await unlink(path.join(dir, d)).catch((e: unknown) => {
        // A file that's already gone is fine. Any OTHER failure means the
        // delete didn't happen, so the merge result would silently keep content
        // that should have been removed — surface it instead of swallowing.
        if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e;
      });
    }
    if (await hasPendingChanges(dir)) {
      await snapshotWorkingTreeUnlocked({
        projectDir: dir,
        message,
        authorName: params.authorName,
        authorEmail: params.authorEmail,
      });
    }
  };

  // Pre-merge step: "(online copy)" files + delete-conflict equalization,
  // committed on the local side so the merge sees them.
  await applyChanges(
    plan.preWrites,
    plan.preDeletes,
    "Saved your choices for combining with the online version",
  );

  // The honest two-parent merge. The driver decides per-file; undecided files
  // auto-merge exactly like a normal merge (diff3). If anything is STILL
  // conflicted (an undecided file), the merge aborts untouched and the
  // remaining files go back to the author.
  const conflict = await commitHonestMerge({
    dir,
    cache,
    branch,
    theirs: remoteId,
    author,
    snapshotId,
    allowUnrelatedHistories: params.allowUnrelatedHistories,
    mergeDriver: ({ contents, path: filepath }) => {
      const base = contents[0] ?? "";
      const mine = contents[1] ?? "";
      const theirs = contents[2] ?? "";
      const choice = plan.driverChoice.get(filepath);
      if (choice === "mine") return { cleanMerge: true, mergedText: mine };
      if (choice === "theirs") return { cleanMerge: true, mergedText: theirs };
      return defaultDiff3(base, mine, theirs);
    },
  });
  if (conflict) return conflict;

  // Binary safety: overwrite decided files with raw Uint8Array bytes from the
  // chosen side's git object. For text files this is a no-op (same bytes); for
  // binary files it corrects the UTF-8 corruption the string-based merge driver
  // introduces. We write directly without a new commit — the bytes match the
  // blob the merge commit already records (same oid), so the working tree stays
  // consistent with HEAD.
  for (const fix of plan.postBinaryFixes) {
    const abs = path.join(dir, fix.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, fix.content);
  }

  // Post-merge step: restore the author's chosen side for delete-involved files
  // that had to be equalized the other way for the merge.
  await applyChanges(plan.postWrites, plan.postDeletes, "Applied your chosen versions");
  return null;
}

/**
 * Push the merged result, with ONE recovery pass: if someone synced between the
 * author's choices and this push, re-fetch the new online tip and either merge
 * it in cleanly and push again (no author interaction) or hand back a FRESH
 * conflict carrying the NEW tip — the UI re-renders the choices screen from a
 * conflict outcome, so the author never sees a dead-end "try again" for a
 * resolvable race. A push still rejected after the recovery merge, or a remote
 * with nothing to fetch, surfaces the friendly race message with the work left
 * safe on disk.
 */
async function pushWithRaceRecovery(params: {
  dir: string;
  cache: GitCache;
  http: typeof httpNode;
  branch: string;
  transport: RemoteTransport;
  author: GitAuthor;
  snapshotId: string | undefined;
}): Promise<SyncOutcome> {
  const { dir, cache, http, branch, transport, author, snapshotId } = params;
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
        code: "race",
        message: MSG_RACE,
        ...(snapshotId ? { snapshotId } : {}),
      };
    }
    const conflict = await commitHonestMerge({
      dir,
      cache,
      branch,
      theirs: newRemoteTip,
      author,
      snapshotId,
    });
    if (conflict) return conflict;
    try {
      await doPush();
    } catch (retryErr) {
      if (isPushRejected(retryErr)) {
        return {
          status: "error",
          code: "race",
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
  const http = options.httpClient ?? defaultGitHttp;
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
      code: "expired-choices",
      message: MSG_EXPIRED_CHOICES,
    };
  }

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // Structural preflight INSIDE the lock — same guard as pullChanges/
    // pushChanges. Without it, the resolve path (the one most likely to run
    // right after an interrupted operation) would snapshot and merge a
    // damaged tree. The typed error routes the caller through recover().
    await assertNoStructuralDamage(options.projectDir, logger);
    // One object cache for this resolve operation only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);
      const author = await resolveGitAuthor(dir, options.authorName, options.authorEmail);

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
        return { status: "error", code: "expired-choices", message: MSG_EXPIRED_CHOICES };
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
      // (resolution-plan.ts) with the two blob reads injected; this module owns
      // the git side-effects of applying the plan below.
      const plan = await buildResolutionPlan(options.resolutions, localTip, remoteId, {
        readBlob: (oid, filepath) => tryReadBlob(dir, oid, filepath, cache),
        uniqueOnlineCopyPath: (filepath, oids, content) =>
          uniqueOnlineCopyPath(dir, filepath, oids, content, cache),
      });

      // Apply the plan into an honest two-parent merge. Bails with a `conflict`
      // outcome if an undecided file still conflicts (the merge aborts untouched).
      const conflict = await applyPlan({
        dir,
        cache,
        branch,
        author,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
        plan,
        remoteId,
        allowUnrelatedHistories: options.allowUnrelatedHistories ?? false,
        snapshotId,
      });
      if (conflict) return conflict;

      // Push the merged result, recovering from a mid-resolution race in one pass.
      return await pushWithRaceRecovery({
        dir,
        cache,
        http,
        branch,
        transport,
        author,
        snapshotId,
      });
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        logger.error("resolve", `setup error`, { error: setupMsg });
        return {
          status: "error",
          message: setupMsg,
          code: "needs-connection-setup",
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      logger.error("resolve", `unexpected error`, { error: errMsg });
      return failureOutcome(e, snapshotId);
    }
  });
}
