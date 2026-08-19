/**
 * Snapshot-first, ALWAYS-CONVERGING sync (#15, ADR 0006 D5; converge ruling
 * 2026-08-14 — see converge-merge.ts).
 *
 * The three operations here are the isomorphic-git library call of the same
 * name plus minimum glue (pure isomorphic-git — CLAUDE.md §7):
 *
 *   - pullChanges  = snapshot-if-needed → `git.fetch` + converge-merge +
 *     `git.checkout` (fetch and merge stay separate calls — NOT `git.pull` —
 *     because `git.pull` negotiates the fetch with the LOCAL branch tip as
 *     the `have`, which on a snapshot-heavy repo makes the server send the
 *     entire repository; see `fetchRemoteTip` for the hard-won fix)
 *   - pushChanges  = snapshot-if-needed → `git.push`
 *   - syncProject  = pullChanges, then pushChanges
 *
 * Snapshot-first invariant (ADR 0006 D5): pull/push commit any unsaved work
 * BEFORE any network or merge step can touch it.
 *
 * There is NO conflict outcome and NO interactive resolution. The merge
 * always lands (converge-merge.ts): overlapping text edits are kept together
 * in the file inside standard git conflict markers; clashing binaries keep
 * the newer side (images additionally reported for the host's non-blocking
 * picker); an edit always survives a deletion. The other version of anything
 * is reachable in history — "Previous versions" IS the safety net.
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
import { isPushRejected, isUnrelatedHistories } from "./recovery/classify.ts";
import { convergeMerge } from "./converge-merge.ts";
import {
  MSG_BUSY,
  MSG_PULL_FIRST,
  MSG_PULL_UP_TO_DATE,
  MSG_PULLED,
  MSG_PULLED_MERGED,
  MSG_PUSH_UP_TO_DATE,
  MSG_SYNCED,
  MSG_SYNCED_MERGED,
  MSG_UNRELATED,
  MSG_UP_TO_DATE,
  MSG_UP_TO_DATE_PULLED,
} from "./sync-messages.ts";
import {
  assertNoStructuralDamage,
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
  ImageClash,
  PullOutcome,
  PushOutcome,
  SyncOutcome,
  SyncProjectOptions,
  SyncRetryOptions,
} from "./sync-types.ts";

// ── Re-exports: the module's public surface ──────────────────────────────────
export { onAuthFor };
export { SYNC_SNAPSHOT_MESSAGE } from "./sync-messages.ts";
export type {
  ImageClash,
  PullOutcome,
  PushOutcome,
  SyncOutcome,
  SyncProjectOptions,
} from "./sync-types.ts";

/**
 * Default sync retry budget (BUG 6): 3 bounded passes with a short backoff.
 * A fast-moving remote can race the push once or twice invisibly; a remote
 * that genuinely races EVERY pass still terminates with a friendly message
 * and the work safely snapshotted.
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

// The structural preflight (assertNoStructuralDamage, transport.ts) runs
// INSIDE pullChanges' and pushChanges' repo lock; syncProject deliberately
// has NO entry preflight of its own — its first pull hits the guard before
// any try/catch, so the typed error propagates identically, and each
// inspectRepo runs once per locked operation instead of an extra time per
// ~2-minute auto-sync.

/**
 * Snapshot-first sync (ADR 0006 D5) — the composition of {@link pullChanges}
 * then {@link pushChanges}. If someone pushes between our pull and our push,
 * the push reports pull-first and the pair re-runs (their commits converge in
 * on the next pass), with a short backoff between passes. The loop is ALWAYS
 * bounded by `retry.attempts`; a remote that races every pass surfaces a
 * friendly "try again in a moment" rather than looping forever. Never throws
 * for expected outcomes — everything is reported through {@link SyncOutcome}.
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
  // Accumulated across passes: a pass that converged text/images keeps its
  // report even if a later pass merges more.
  const combinedFiles = new Set<string>();
  const imageClashes: ImageClash[] = [];
  const convergeExtras = () => ({
    ...(combinedFiles.size > 0 ? { combinedFiles: [...combinedFiles].sort() } : {}),
    ...(imageClashes.length > 0 ? { imageClashes } : {}),
  });
  for (let attempt = 0; attempt < attempts; attempt++) {
    logger.info("sync", `sync pass ${attempt + 1}/${attempts}`);
    const pull = await pullChanges(options);
    snapshotId = snapshotId ?? pull.snapshotId;
    const base = snapshotId ? { snapshotId } : {};
    if (pull.status !== "pulled" && pull.status !== "up-to-date") {
      logger.warn("sync", `pull non-success`, { status: pull.status });
      return { ...pull, ...base }; // auth / offline / error
    }
    pulled = pulled || pull.status === "pulled";
    filesChanged = filesChanged || (pull.status === "pulled" && pull.filesChanged);
    if (pull.status === "pulled") {
      for (const f of pull.combinedFiles ?? []) combinedFiles.add(f);
      imageClashes.push(...(pull.imageClashes ?? []));
    }

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
          ...convergeExtras(),
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
        // loop is about to exit). Their commits converge in on the next pull.
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
    message: MSG_BUSY,
    ...(filesChanged ? { filesChanged: true } : {}),
    ...convergeExtras(),
    ...(snapshotId ? { snapshotId } : {}),
  };
}

// ── pullChanges ──────────────────────────────────────────────────────────────

/**
 * Pull-only operation (the History tab's "Pull"): snapshot-if-needed →
 * fetch → fast-forward or CONVERGE-merge of the online changes — NEVER a
 * push, never a question. Serialized on the per-repo lock; one
 * function-scoped object cache, released on return.
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
    // Structural preflight INSIDE the lock: never snapshot/merge a damaged
    // tree — the typed error routes the caller to repairRepo.
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
        logger,
      });

      const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);
      const localTip = await git.resolveRef({ fs, dir, ref: branch });
      const base = snapshotId ? { snapshotId } : {};

      logger.info("pull", `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)}`);

      if (!remoteTip || remoteTip === localTip) {
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }

      // The converge-merge ALWAYS lands: fast-forward when local is behind,
      // no-op when already ahead, and a fixed-policy combine when both sides
      // moved (markers for text, newer-wins for binary, edit-beats-delete).
      let converge;
      try {
        converge = await convergeMerge({
          dir,
          cache,
          branch,
          theirs: remoteTip,
          author: await resolveGitAuthor(dir, options.authorName, options.authorEmail),
          authorName: options.authorName,
          authorEmail: options.authorEmail,
        });
      } catch (e) {
        // A wrong online address must not silently splice two unrelated
        // projects together — surface it as a plain setup problem.
        if (isUnrelatedHistories(e)) {
          logger.warn("pull", "unrelated histories — refusing to combine");
          return { status: "error", message: MSG_UNRELATED, ...base };
        }
        throw e;
      }
      const newTip = converge.oid;
      if (newTip === localTip) {
        // No-op (`alreadyMerged`): we were already ahead of the online tip.
        return { status: "up-to-date", message: MSG_PULL_UP_TO_DATE, ...base };
      }
      if (converge.combinedFiles.length > 0) {
        logger.info("pull", `combined with markers`, { files: converge.combinedFiles });
      }
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
        ...(converge.combinedFiles.length > 0
          ? { combinedFiles: converge.combinedFiles }
          : {}),
        ...(converge.imageClashes.length > 0
          ? { imageClashes: converge.imageClashes }
          : {}),
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
    // Structural preflight INSIDE the lock: the History tab's Push button
    // calls pushChanges directly — otherwise a half-done native-git merge's
    // conflict markers get snapshotted and published to every collaborator.
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
        logger,
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
