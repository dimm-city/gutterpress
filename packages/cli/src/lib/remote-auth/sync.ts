/**
 * Snapshot-first sync + conflict resolution (#15, ADR 0006 D5).
 *
 * This module is the thin ORCHESTRATOR that composes the extracted pieces:
 *
 *   - sync-types.ts           — the result/option/transport type surface
 *   - sync-messages.ts        — the author-language copy (never raw git words)
 *   - transport.ts            — clone/fetch/push transport + onAuth wiring,
 *                               snapshot-if-needed, failure/conflict mappers
 *   - conflict-resolution.ts  — resolveConflicts + the resolution-plan apply
 *                               and push/race-recovery helpers
 *
 * The three operations defined here are the isomorphic-git library call of the
 * same name plus minimum glue (pure isomorphic-git — CLAUDE.md §7):
 *
 *   - pullChanges  = snapshot-if-needed → `git.fetch` + `git.merge` +
 *     `git.checkout` (fetch and merge stay separate calls — NOT `git.pull` —
 *     because `git.pull` negotiates the fetch with the LOCAL branch tip as
 *     the `have`, which on a snapshot-heavy repo makes the server send the
 *     entire repository; see `fetchRemoteTip` for the hard-won fix)
 *   - pushChanges  = snapshot-if-needed → `git.push`
 *   - syncProject  = pullChanges, then pushChanges
 *
 *   Snapshot-first invariant (ADR 0006 D5): pull/push commit any unsaved work
 *   BEFORE any network or merge step can touch it. True conflict → abort
 *   cleanly (the working tree is NEVER left with conflict markers —
 *   `abortOnConflict` keeps the tree at the pre-merge snapshot) and return
 *   `{ status: "conflict", files }` so the UI can ask per-file: Keep my
 *   version · Use the online version · Keep both copies.
 *
 * Failure model (ADR 0006 D5/D7): offline → friendly retry-later (the snapshot
 * already saved the work locally); 401/403 → `{ status: "auth" }` for the
 * single "Reconnect" action; anything else → a friendly, jargon-free message.
 * Token values never appear in messages (transport errors are mapped, and the
 * remote URL used is pre-sanitized via `extractUrlCredential`).
 */
import * as fs from "node:fs";

import git from "isomorphic-git";
import { defaultGitHttp } from "./git-http.ts";

import { resolveGitAuthor, withRepoLock } from "../source-provider.ts";
import { resolveLogger } from "./operation-log.ts";
import { isMergeConflictError, isPushRejected } from "./recovery/classify.ts";
import {
  MSG_CONFLICT,
  MSG_PULL_FIRST,
  MSG_PULL_UP_TO_DATE,
  MSG_PULLED,
  MSG_PULLED_MERGED,
  MSG_PUSH_UP_TO_DATE,
  MSG_RACE,
  MSG_SYNCED,
  MSG_SYNCED_MERGED,
  MSG_UP_TO_DATE,
  MSG_UP_TO_DATE_PULLED,
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
  short,
  snapshotBeforeAction,
} from "./transport.ts";
import type {
  GitCache,
  PullOutcome,
  PushOutcome,
  SyncOutcome,
  SyncProjectOptions,
  SyncRetryOptions,
} from "./sync-types.ts";

// ── Re-exports: the module's public surface stays byte-for-byte identical ─────
export { onAuthFor, conflictFilesFrom };
export { onlineCopyPath, resolveConflicts } from "./conflict-resolution.ts";
export { SYNC_SNAPSHOT_MESSAGE } from "./sync-messages.ts";
export type {
  ConflictFile,
  ConflictKind,
  ConflictResolution,
  PullOutcome,
  PushOutcome,
  ResolveConflictsOptions,
  SyncOutcome,
  SyncProjectOptions,
} from "./sync-types.ts";

/**
 * Default sync retry budget (BUG 6): 3 bounded passes with a short backoff.
 * A fast-moving remote can race the push once or twice without the user seeing
 * the false "Someone else synced at the same moment" message; a remote that
 * genuinely races EVERY pass still terminates with that friendly message and
 * the work safely snapshotted.
 */
const DEFAULT_SYNC_RETRY: Required<Omit<SyncRetryOptions, "sleep">> = {
  attempts: 3,
  backoffMs: 150,
};

// ── syncProject ────────────────────────────────────────────────────────────

/** Real-timer sleep used as the default backoff between sync passes. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// assertNoStructuralDamage now lives in transport.ts (shared with
// conflict-resolution.ts, whose resolve path was originally missing the
// guard). It runs INSIDE pullChanges'/pushChanges'/resolveConflicts' repo
// lock; syncProject deliberately has NO entry preflight of its own — its
// first pull hits the guard before any try/catch, so the typed error
// propagates identically, and each inspectRepo runs once per locked
// operation instead of an extra time per ~2-minute auto-sync.

/**
 * Snapshot-first sync (ADR 0006 D5) — the composition of {@link pullChanges}
 * then {@link pushChanges}. If someone pushes between our pull and our push,
 * the push reports pull-first and the pair re-runs (their commits merge in on
 * the next pass), with a short backoff between passes. The loop is ALWAYS
 * bounded by `retry.attempts` (BUG 6 — a fast-moving remote no longer triggers
 * a FALSE race message after only two attempts); a remote that genuinely races
 * every pass surfaces a friendly "try again" rather than looping forever. The
 * snapshot-first guarantee holds on every path (the work is saved locally
 * before any network step). Never throws for expected outcomes — everything is
 * reported through the {@link SyncOutcome} union.
 */
export async function syncProject(
  options: SyncProjectOptions,
): Promise<SyncOutcome> {
  const logger = resolveLogger(options.logFile, "sync");
  // Bounded, defaulted retry policy. attempts ≥ 1, backoffMs ≥ 0 (clamped so a
  // caller can never request an unbounded or negative-delay loop).
  const attempts = Math.max(1, options.retry?.attempts ?? DEFAULT_SYNC_RETRY.attempts);
  const backoffMs = Math.max(0, options.retry?.backoffMs ?? DEFAULT_SYNC_RETRY.backoffMs);
  const sleep = options.retry?.sleep ?? defaultSleep;

  let snapshotId: string | undefined;
  let pulled = false;
  let filesChanged = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    logger.info("sync", `sync pass ${attempt + 1}/${attempts}`);
    const pull = await pullChanges(options);
    snapshotId = snapshotId ?? pull.snapshotId;
    const base = snapshotId ? { snapshotId } : {};
    if (pull.status === "conflict") {
      logger.warn("sync", `pull conflict`, { files: pull.files.map((f) => f.path) });
      return { ...pull, ...base };
    }
    if (pull.status !== "pulled" && pull.status !== "up-to-date") {
      logger.warn("sync", `pull non-success`, { status: pull.status });
      return { ...pull, ...base }; // auth / offline / error
    }
    pulled = pulled || pull.status === "pulled";
    filesChanged = filesChanged || (pull.status === "pulled" && pull.filesChanged);

    const push = await pushChanges(options);
    snapshotId = snapshotId ?? push.snapshotId;
    switch (push.status) {
      case "pushed":
        logger.info("sync", `synced`, { pulled });
        return {
          status: "synced",
          message: pulled ? MSG_SYNCED_MERGED : MSG_SYNCED,
          mergedRemoteChanges: pulled,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "up-to-date":
        logger.info("sync", `up-to-date`, { pulled });
        return {
          status: "up-to-date",
          message: pulled ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
      case "pull-first":
        logger.info("sync", `push rejected (non-fast-forward) — retrying`);
        // Someone pushed mid-sync — re-run the pair. Back off briefly before
        // the next pass (skip the sleep after the final attempt, since the
        // loop is about to exit). Their commits merge in on the next pull.
        if (attempt < attempts - 1 && backoffMs > 0) await sleep(backoffMs);
        continue;
      default:
        logger.warn("sync", `push non-success`, { status: push.status });
        return {
          ...push,
          ...(filesChanged ? { filesChanged: true } : {}),
          ...(snapshotId ? { snapshotId } : {}),
        };
    }
  }
  logger.error("sync", `exhausted ${attempts} retry attempts (race)`);
  return {
    status: "error",
    code: "race",
    message: MSG_RACE,
    ...(filesChanged ? { filesChanged: true } : {}),
    ...(snapshotId ? { snapshotId } : {}),
  };
}

// ── pullChanges ──────────────────────────────────────────────────────────────

/**
 * Pull-only operation (the History tab's "Pull"): snapshot-if-needed →
 * fetch → fast-forward or clean merge of the online changes — NEVER a push.
 *
 * Same conflict semantics as {@link syncProject}: `abortOnConflict` keeps the
 * working tree completely untouched and the conflict comes back as
 * `{ status: "conflict", files }` for the per-file choices dialog. Serialized
 * on the per-repo lock; one function-scoped object cache, released on return.
 */
export async function pullChanges(
  options: SyncProjectOptions,
): Promise<PullOutcome> {
  const http = options.httpClient ?? defaultGitHttp;
  // A project is its git repo: pull operates on the enclosing repo root
  // (opening a subfolder syncs the whole repo — that is what Git does).
  const dir = await repoDirFor(options.projectDir);

  return withRepoLock(dir, async (): Promise<PullOutcome> => {
    // One logger per locked operation (preflight + body share it).
    const logger = resolveLogger(options.logFile, "sync");
    // Structural preflight INSIDE the lock (deep-analysis fix): the History
    // tab's Pull button calls pullChanges directly, not via syncProject, so it
    // needs the same "don't snapshot+push a damaged tree" guard.
    await assertNoStructuralDamage(options.projectDir, logger);
    // One object cache for this pull only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot FIRST (D5) — the merge below ends in a forced checkout, so
      // committing the whole working tree first guarantees nothing is lost.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        message: options.message,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
        cache,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      logger.info("pull", `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)}`);

      if (!remoteTip || remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }

      // Let git.merge decide: it fast-forwards when local is behind, makes a
      // combine commit when both sides moved, no-ops (`alreadyMerged`) when we
      // are already ahead, and throws MergeConflictError on a true conflict.
      // `abortOnConflict` (default true) guarantees a conflicted merge leaves
      // the working tree and index COMPLETELY untouched.
      try {
        await git.merge({
          fs,
          dir,
          cache,
          ours: branch,
          theirs: remoteTip,
          author: await resolveGitAuthor(dir, options.authorName, options.authorEmail),
          message: "Combined your changes with the online version",
        });
      } catch (e) {
        if (isMergeConflictError(e)) {
          const conflictPaths = conflictFilesFrom(e.data).map((f) => f.path);
          logger.warn("pull", `merge conflict`, {
            files: conflictPaths,
            local: short(localTip),
            remote: short(remoteTip),
          });
          return {
            status: "conflict",
            message: MSG_CONFLICT,
            files: conflictFilesFrom(e.data),
            localId: localTip,
            remoteId: remoteTip,
            ...base,
          };
        }
        throw e;
      }
      const newTip = await git.resolveRef({ fs, dir, ref: branch });
      if (newTip === localTip) {
        // The merge was a no-op (`alreadyMerged`): we were already ahead of
        // the online tip, so there was nothing to bring down.
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }
      // merge() moves the branch ref but does not update the working tree —
      // sync it. The tree is clean (snapshotted above), so the forced
      // checkout can't discard anything.
      await git.checkout({ fs, dir, cache, ref: branch, force: true });
      // A fast-forward lands exactly on the online tip; anything else means a
      // combine (merge) commit was created.
      const merged = newTip !== remoteTip;
      // "Did the content change?" — compare the commits' tree ids (cheap,
      // commit objects only). A merge that nets out to the same tree (e.g.
      // both sides made the identical edit) needs no preview reload.
      const treeBefore = (await git.readCommit({ fs, dir, cache, oid: localTip }))
        .commit.tree;
      const treeAfter = (await git.readCommit({ fs, dir, cache, oid: newTip }))
        .commit.tree;
      return {
        status: "pulled",
        message: merged ? MSG_PULLED_MERGED : MSG_PULLED,
        merged,
        filesChanged: treeBefore !== treeAfter,
        ...base,
      };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        return {
          status: "error",
          message: setupMsg,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}

// ── pushChanges ──────────────────────────────────────────────────────────────

/**
 * Push-only operation (the History tab's "Push"): snapshot-if-needed → push.
 * If the online copy has commits this computer doesn't have (non-fast-forward),
 * it does NOT auto-merge — the typed `"pull-first"` result tells the host to
 * show a plain-language "get the latest changes first" message. Serialized on
 * the per-repo lock; one function-scoped object cache, released on return.
 */
export async function pushChanges(
  options: SyncProjectOptions,
): Promise<PushOutcome> {
  const http = options.httpClient ?? defaultGitHttp;
  const dir = await repoDirFor(options.projectDir);

  return withRepoLock(dir, async (): Promise<PushOutcome> => {
    // One logger per locked operation (preflight + body share it).
    const logger = resolveLogger(options.logFile, "sync");
    // Structural preflight INSIDE the lock (deep-analysis fix): the History
    // tab's Push button calls pushChanges directly — otherwise a half-done
    // native-git merge's conflict markers get snapshotted and published to
    // every collaborator.
    await assertNoStructuralDamage(options.projectDir, logger);
    // One object cache for this push only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot-if-needed (D5) so unsaved work is part of what gets sent.
      snapshotId = await snapshotBeforeAction({
        projectDir: options.projectDir,
        dir,
        message: options.message,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
        cache,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      logger.info("push", `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)} snapshot=${snapshotId ? short(snapshotId) : "none"}`);

      if (remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PUSH_UP_TO_DATE, ...base };
      }

      // No pre-push "is the remote ahead?" history walk here: on a large
      // repository an isDescendent walk over old history loads entire
      // packfiles (gigabytes of RSS). The push rejection below is the
      // authoritative guard — isomorphic-git refuses a non-fast-forward
      // client-side against the fresh ref advertisement, and the server
      // rejects any race after that. Both map to the same "pull-first".
      try {
        await git.push({
          fs,
          http,
          dir,
          cache,
          remote: transport.remote,
          ref: branch,
          ...onAuthFor(transport.credential),
        });
      } catch (e) {
        // The online copy is ahead (or diverged): never auto-merge here.
        if (isPushRejected(e)) {
          return { status: "pull-first", message: MSG_PULL_FIRST, ...base };
        }
        throw e;
      }
      return { status: "pushed", message: MSG_SYNCED, ...base };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) {
        return {
          status: "error",
          message: setupMsg,
          ...(snapshotId ? { snapshotId } : {}),
        };
      }
      return failureOutcome(e, snapshotId);
    }
  });
}
