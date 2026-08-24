/**
 * Snapshot-first, ALWAYS-CONVERGING sync (#15, ADR 0006 D5; converge ruling
 * 2026-08-14 — see converge-merge.ts).
 *
 * ONE operation: `syncProject` = snapshot-if-needed → `git.fetch` +
 * converge-merge + `git.checkout` → `git.push`, all inside a single repo
 * lock. (Fetch and merge stay separate calls — NOT `git.pull` — because
 * `git.pull` negotiates the fetch with the LOCAL branch tip as the `have`,
 * which on a snapshot-heavy repo makes the server send the entire
 * repository; see `fetchRemoteTip` for the hard-won fix.)
 *
 * There is no separate pull or push entry point: nothing in the product ever
 * called one. The CLI has no sync surface at all and the desktop has exactly
 * one Sync button, so "get theirs" and "send mine" were never separately
 * reachable — splitting them only bought two extra `withRepoLock` +
 * transport-resolution + tree-walk rounds per ~2-minute auto-sync, and a
 * window in which the lock was RELEASED between
 * the two halves. The push CADENCE is instead a flag on the one operation
 * (`push: false` = pull-merge-only pass; owner decision 2026-08-23), so the
 * desktop's frequent ticks keep pulling while pushes batch up quietly.
 *
 * Snapshot-first invariant (ADR 0006 D5): sync commits any unsaved work
 * BEFORE any network or merge step can touch it.
 *
 * There is NO conflict outcome and NO interactive resolution. The merge
 * always lands (converge-merge.ts): overlapping text edits are kept together
 * in the file inside standard git conflict markers; a clashing binary keeps
 * BOTH versions as two files (ours, plus theirs as a `.online` sibling,
 * reported so the host can name the pair); an edit always survives a
 * deletion. Every version is reachable in history — "Previous versions" IS
 * the safety net.
 *
 * Failure model (ADR 0006 D5/D7): offline → friendly retry-later (the snapshot
 * already saved the work locally); 401/403 → `{ status: "auth" }` for the
 * single "Reconnect" action; anything else → a friendly, jargon-free message.
 * Token values never appear in messages (transport errors are mapped, and the
 * remote URL used is pre-sanitized via `extractUrlCredential`).
 */
// Atomic writes for git metadata — see git-fs.ts. Drop-in for node:fs.
import { gitFs as fs } from "../git-fs.ts";

import git from "isomorphic-git";
import { defaultGitHttp } from "./git-http.ts";

import { resolveGitAuthor, withRepoLock } from "../source-provider.ts";
import { resolveLogger } from "./operation-log.ts";
import { convergeMerge } from "./converge-merge.ts";
import {
  MSG_BUSY,
  SYNC_LATE_EDIT_MESSAGE,
  MSG_SYNCED,
  MSG_SYNCED_MERGED,
  MSG_HISTORY_UNREADABLE,
  MSG_UNRELATED,
  MSG_UP_TO_DATE,
  MSG_UP_TO_DATE_PULLED,
} from "./sync-messages.ts";
import {
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
  KeptBothFile,
  SyncOutcome,
  SyncProjectOptions,
  SyncRetryOptions,
} from "./sync-types.ts";

// ── Re-exports: the module's public surface ──────────────────────────────────
export { onAuthFor };
export { SYNC_SNAPSHOT_MESSAGE } from "./sync-messages.ts";
export type {
  KeptBothFile,
  SyncOutcome,
  SyncProjectOptions,
} from "./sync-types.ts";

/**
 * A push the remote refused because our branch is behind — the pull-first
 * situation the retry loop exists for.
 */
export function isPushRejected(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  // PushRejectedError carries a typed `data.reason`. ONLY a genuine
  // non-fast-forward ("not-fast-forward") is fixable by pulling first; other
  // reasons (e.g. "tag-exists") are not and must fall through to the friendly
  // auth/error classifier. Treat a reason-less PushRejectedError as the
  // historical non-fast-forward (back-compat — that is what it meant before
  // isomorphic-git started attaching a reason).
  if (code === "PushRejectedError") {
    const reason = (e as { data?: { reason?: string } })?.data?.reason;
    return reason === undefined || reason === "not-fast-forward";
  }
  // Server-side rejection arrives as GitPushError; only the report-status line
  // that actually says non-fast-forward is a pull-first situation. A
  // permission/hook decline ("permission denied", "pre-receive hook declined",
  // …) must NOT be treated as a non-fast-forward.
  if (code === "GitPushError") {
    const msg =
      ((e as { data?: { prettyDetails?: string } })?.data?.prettyDetails ?? "") +
      " " +
      ((e as Error)?.message ?? "");
    return /non-fast-forward|would not be a fast-forward|not a simple fast-forward/i.test(
      msg,
    );
  }
  return false;
}

/**
 * Unrelated histories — the local project and the configured online project
 * share no common starting point. Sync surfaces this as a plain setup error
 * (a wrong online address must never be silently spliced into the book).
 */
export function isUnrelatedHistories(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? String(e);
  return (
    code === "MergeNotSupportedError" ||
    /unrelated histories|no common commits|refusing to merge unrelated/i.test(msg)
  );
}

/**
 * Can this repo's history be read at all? Asked only AFTER a sync has already
 * failed, to tell a transient failure ("try again") apart from a damaged
 * history (trying again will never work). Deliberately a plain read of the
 * three things every sync needs — the branch tip, its commit, and the index —
 * rather than a health taxonomy: the answer only has to pick the message.
 */
async function historyUnreadable(dir: string): Promise<boolean> {
  try {
    const oid = await git.resolveRef({ fs, dir, ref: "HEAD" });
    await git.readCommit({ fs, dir, oid });
    await git.listFiles({ fs, dir });
    return false;
  } catch {
    return true;
  }
}

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

/** Real-timer sleep used as the default backoff between sync passes. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Snapshot-first sync (ADR 0006 D5). Serialized on the per-repo lock; one
 * function-scoped object cache, released on return.
 *
 * If someone pushes between our fetch and our push, the push is rejected and
 * the fetch→merge→push pass re-runs (their commits converge in on the next
 * fetch), with a short backoff between passes. The loop is ALWAYS bounded by
 * `retry.attempts`; a remote that races every pass surfaces a friendly "try
 * again in a moment" rather than looping forever. Never throws for expected
 * outcomes — everything is reported through {@link SyncOutcome}.
 */
export async function syncProject(
  options: SyncProjectOptions,
): Promise<SyncOutcome> {
  const http = options.httpClient ?? defaultGitHttp;
  // Full pass by default; `push: false` is the pull-merge-only tick.
  const push = options.push ?? true;
  // Bounded, defaulted retry policy. attempts ≥ 1, backoffMs ≥ 0 (clamped so a
  // caller can never request an unbounded or negative-delay loop).
  const attempts = Math.max(1, options.retry?.attempts ?? DEFAULT_SYNC_RETRY.attempts);
  const backoffMs = Math.max(0, options.retry?.backoffMs ?? DEFAULT_SYNC_RETRY.backoffMs);
  const sleep = options.retry?.sleep ?? defaultSleep;
  // A project is its git repo: sync operates on the enclosing repo root
  // (opening a subfolder syncs the whole repo — that is what Git does).
  const dir = await repoDirFor(options.projectDir);

  return withRepoLock(dir, async (): Promise<SyncOutcome> => {
    // One logger per locked operation.
    const logger = resolveLogger(options.logFile, "sync");
    // One object cache for this sync only — released with it.
    const cache: GitCache = {};
    let snapshotId: string | undefined;
    // Accumulated across passes: a pass that converged files keeps its report
    // even if a later pass merges more.
    let pulled = false;
    let filesChanged = false;
    const combinedFiles = new Set<string>();
    const keptBothFiles: KeptBothFile[] = [];
    const base = () => ({
      ...(filesChanged ? { filesChanged: true } : {}),
      ...(snapshotId ? { snapshotId } : {}),
    });
    // The converge report rides on every arm that can have combined something:
    // the "synced" arm, the exhausted-retries error, and a pull-merge-only
    // pass's deferred-push return (it can merge overlapping edits and then
    // hold the push). The plain `tip === remoteTip` up-to-date return cannot —
    // reaching it means the merge fast-forwarded or no-op'd, combining nothing.
    const convergeExtras = () => ({
      ...(combinedFiles.size > 0 ? { combinedFiles: [...combinedFiles].sort() } : {}),
      ...(keptBothFiles.length > 0 ? { keptBothFiles } : {}),
    });

    try {
      const branch = await currentBranchOrThrow(dir);
      const transport = await resolveTransport(dir, options);

      // Snapshot FIRST (D5) — commit the whole working tree before any network
      // or merge step can touch it. A pull-merge-only pass defers this to the
      // post-fetch snapshot below: nothing in that pass touches the working
      // tree unless the remote moved (the fetch only writes under .git), and
      // the merge-guard snapshot always runs before any merge does. That is
      // what lets a quiet pull-only tick mint NO commit while the author
      // types, instead of a snapshot per tick (the F4 "commit wall").
      if (push) {
        snapshotId = await snapshotBeforeAction({
          projectDir: options.projectDir,
          dir,
          message: options.message,
          authorName: options.authorName,
          authorEmail: options.authorEmail,
          cache,
        });
      }

      for (let attempt = 0; attempt < attempts; attempt++) {
        logger.info("sync", `sync pass ${attempt + 1}/${attempts}`);
        const remoteTip = await fetchRemoteTip(dir, branch, transport, http, cache);

        let localTip = await git.resolveRef({ fs, dir, ref: branch });
        // …AND SNAPSHOT AGAIN, because the fetch above is a network round-trip
        // and the author never stopped typing: the desktop editor's autosave
        // fires 500 ms after the last keystroke, so an edit routinely reaches
        // disk between the snapshot and the merge. It is in NO commit, and the
        // merge ends in a checkout — leave it uncommitted and it is what the
        // author just wrote AND the version that disappears. Committing it
        // here makes it ordinary local work: the merge below combines it
        // (markers if an online edit overlaps) instead of overwriting it, and
        // the "did anything change?" reporting below is computed from a tip
        // that already includes it, so a solo author's racing sync still
        // reports plainly up-to-date. Reported as THE snapshot for this sync —
        // it holds strictly more of the author's work than the earlier one.
        // On a pull-merge-only pass this is the ONLY snapshot, taken exactly
        // when it is needed: a merge (which ends in a checkout) is coming.
        if (push || (remoteTip !== null && remoteTip !== localTip)) {
          const lateSnapshot = await snapshotBeforeAction({
            projectDir: options.projectDir,
            dir,
            message: SYNC_LATE_EDIT_MESSAGE,
            authorName: options.authorName,
            authorEmail: options.authorEmail,
            cache,
          });
          if (lateSnapshot) {
            snapshotId = lateSnapshot;
            localTip = await git.resolveRef({ fs, dir, ref: branch });
          }
        }
        logger.info(
          "sync",
          `branch=${branch} local=${short(localTip)} fetched=${short(remoteTip)} snapshot=${snapshotId ? short(snapshotId) : "none"}`,
        );

        // The converge-merge ALWAYS lands: fast-forward when local is behind,
        // no-op when already ahead, and a fixed-policy combine when both sides
        // moved (markers for text, keep-both for binary, edit-beats-delete).
        let tip = localTip;
        if (remoteTip && remoteTip !== localTip) {
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
            // Two unrelated projects must never be silently spliced together.
            // NOTE the message names both causes: a destroyed ref store also
            // lands here (sync's snapshot restarts the branch from nothing, so
            // by this point the repo reads fine — it is simply unrelated now).
            if (isUnrelatedHistories(e)) {
              logger.warn("sync", "unrelated histories — refusing to combine");
              return { status: "error", message: MSG_UNRELATED, ...base() };
            }
            throw e;
          }
          tip = converge.oid;
          // `tip === localTip` is the no-op (`alreadyMerged`) case: we were
          // already ahead of the online tip, so nothing came DOWN.
          if (tip !== localTip) {
            pulled = true;
            // "Did the content change?" — compare the commits' tree ids
            // (cheap, commit objects only). A merge that nets out to the same
            // tree (e.g. both sides made the identical edit) needs no preview
            // reload.
            const [before, after] = await Promise.all([
              git.readCommit({ fs, dir, cache, oid: localTip }),
              git.readCommit({ fs, dir, cache, oid: tip }),
            ]);
            filesChanged = filesChanged || before.commit.tree !== after.commit.tree;
            for (const f of converge.combinedFiles) combinedFiles.add(f);
            keptBothFiles.push(...converge.keptBothFiles);
            if (converge.combinedFiles.length > 0) {
              logger.info("sync", `combined with markers`, { files: converge.combinedFiles });
            }
          }
        }

        if (tip === remoteTip) {
          logger.info("sync", `up-to-date`, { pulled });
          return {
            status: "up-to-date",
            message: pulled ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
            ...base(),
          };
        }

        // Pull-merge-only pass: local commits the remote lacks stay local —
        // the next push-enabled pass sends them. Everything this pass was
        // asked to do is done (remote work merged in, local work committed
        // and safe), so it reports through the up-to-date arm; the converge
        // report rides along because a pull-only merge CAN combine files.
        if (!push) {
          logger.info("sync", `pull-only pass complete — push deferred`, { pulled });
          return {
            status: "up-to-date",
            message: pulled ? MSG_UP_TO_DATE_PULLED : MSG_UP_TO_DATE,
            ...convergeExtras(),
            ...base(),
          };
        }

        // No pre-push "is the remote ahead?" history walk here: on a large
        // repository an isDescendent walk over old history loads entire
        // packfiles (gigabytes of RSS). The push rejection below is the
        // authoritative guard — isomorphic-git refuses a non-fast-forward
        // client-side against the fresh ref advertisement, and the server
        // rejects any race after that.
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
          // Someone pushed between our fetch and our push. Re-run the pass:
          // the next fetch brings their commits down and the merge converges
          // them in. Back off briefly first (skip the sleep after the final
          // attempt, since the loop is about to exit). Anything that is NOT a
          // non-fast-forward rejection — a permission decline, a pre-receive
          // hook — is NOT a race and must surface to the failure classifier.
          if (!isPushRejected(e)) throw e;
          logger.info("sync", `push rejected (non-fast-forward) — retrying`);
          if (attempt < attempts - 1 && backoffMs > 0) await sleep(backoffMs);
          continue;
        }
        logger.info("sync", `synced`, { pulled });
        return {
          status: "synced",
          message: pulled ? MSG_SYNCED_MERGED : MSG_SYNCED,
          mergedRemoteChanges: pulled,
          ...convergeExtras(),
          ...base(),
        };
      }

      logger.error("sync", `exhausted ${attempts} retry attempts (race)`);
      return { status: "error", message: MSG_BUSY, ...convergeExtras(), ...base() };
    } catch (e) {
      const setupMsg = setupErrorMessage(e);
      if (setupMsg) return { status: "error", message: setupMsg, ...base() };
      // A damaged history must not be reported as a transient failure: "please
      // try again" is false when trying again can never work.
      if (await historyUnreadable(dir)) {
        logger.error("sync", "the project's history could not be read");
        return { status: "error", message: MSG_HISTORY_UNREADABLE, ...base() };
      }
      return { ...failureOutcome(e, snapshotId), ...(filesChanged ? { filesChanged: true } : {}) };
    }
  });
}
