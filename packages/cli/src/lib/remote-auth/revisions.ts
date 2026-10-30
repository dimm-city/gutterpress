/**
 * Renaming and deleting revisions (#448).
 *
 * A revision that is also in the online copy is changed there too, right away,
 * when the author asks — never as a hidden step of a later backup. If the online
 * copy can't be reached, refuses the sign-in, or holds versions of the revision
 * this computer lacks, nothing is changed anywhere and the error says so in
 * plain words. Transport and sign-in resolve exactly as `refreshRemoteCopies`
 * does (`resolveTransport`). Local-only revisions are listed, created and
 * switched in source-provider.ts. A revision kept only in the online copy is
 * renamed or deleted there, with nothing to change on this computer.
 */
// Atomic writes for git metadata — see git-fs.ts. Drop-in for node:fs.
import { gitFs as fs } from "../git-fs.ts";

import git from "isomorphic-git";

import { detectProjectSource } from "../project-source.ts";
import {
  assertFreeRevisionName,
  gitScopeFor,
  isContained,
  NO_VERSION_HISTORY,
  readRevisionRefs,
  revisionNameFrom,
  withRepoLock,
  type RevisionRefs,
} from "../source-provider.ts";
import { defaultGitHttp } from "./git-http.ts";
import { MSG_INSECURE_TRANSPORT } from "./sync-messages.ts";
import type { GitCache, RemoteTransport } from "./sync-types.ts";
import type { HostCredential, TokenStore } from "./token-store.ts";
import {
  classifyTransportFailure,
  onAuthFor,
  resolveTransport,
  serverTip,
  setupErrorMessage,
} from "./transport.ts";

/** How the online copy is reached: the same options `refreshRemoteCopies` takes. */
interface OnlineOptions {
  credential?: HostCredential;
  tokenStore?: TokenStore;
  httpClient?: typeof defaultGitHttp;
}

export interface RenameRevisionOptions extends OnlineOptions {
  projectDir: string;
  from: string;
  /** The new name as typed; spaces become hyphens. */
  to: string;
}

export interface DeleteRevisionOptions extends OnlineOptions {
  projectDir: string;
  name: string;
  /** Also remove it from the online copy (when it is there); default: this computer only. */
  everywhere?: boolean;
  /** Delete even though the revision holds versions found nowhere else. */
  discard?: boolean;
}

/** Plain words for a failed call to the online copy; `unchanged` says what stayed as it was. */
function onlineFailure(e: unknown, unchanged: string): Error {
  const setup = setupErrorMessage(e);
  if (setup) return new Error(setup, { cause: e });
  switch (classifyTransportFailure(e)) {
    case "network_unavailable":
      return new Error(
        `Couldn't reach the online copy, so ${unchanged}. Try again when you're back online.`,
        { cause: e },
      );
    case "auth_required":
      return new Error(
        `The online copy didn't accept the saved sign-in, so ${unchanged}. Sign in again and try again.`,
        { cause: e },
      );
    case "insecure_transport":
      return new Error(MSG_INSECURE_TRANSPORT, { cause: e });
    default:
      return new Error(
        `The online copy didn't allow that, so ${unchanged}. Some online copies don't allow changing their main revision.`,
        { cause: e },
      );
  }
}

/** The revision's tip on this computer, or a plain error when it isn't here. */
function localTip(refs: RevisionRefs, name: string): string {
  const tip = refs.local.get(name);
  if (tip) return tip;
  throw new Error(
    refs.online.has(name)
      ? `"${name}" is only in the online copy so far. Switch to it first.`
      : `Couldn't find a revision named "${name}" — it may have been renamed or deleted.`,
  );
}

/** The online copy, reached: its transport and the http client to use with it. */
interface Online {
  transport: RemoteTransport;
  http: typeof defaultGitHttp;
}

/**
 * Reach the online copy to change revision `name`, and check this computer
 * lacks nothing there. Returns `null` when the online copy no longer has the
 * revision (someone removed it), so there is nothing to change online. Throws
 * before anything has changed. `catchUp` says what to do when the online copy is ahead.
 */
async function reachOnline(
  dir: string,
  name: string,
  tip: string,
  catchUp: string,
  options: OnlineOptions,
  unchanged: string,
): Promise<Online | null> {
  const http = options.httpClient ?? defaultGitHttp;
  let transport: RemoteTransport;
  let onlineTip: string | undefined;
  try {
    transport = await resolveTransport(dir, options);
    onlineTip = await serverTip(transport, name, http);
  } catch (e) {
    throw onlineFailure(e, unchanged);
  }
  if (!onlineTip) return null;
  // Only the live tip matters (a long-ago fetch may be stale): if it isn't in
  // this revision's versions, the online copy has work this computer lacks.
  if (!(await isContained(dir, onlineTip, tip, {}))) {
    throw new Error(`The online copy has versions of "${name}" that this computer doesn't have yet. ${catchUp}`);
  }
  return { transport, http };
}

/**
 * Make the online copy's `refs/heads/<remoteName>` point where `ref` does here,
 * or remove it. `ref` must exist on this computer even when removing (it only
 * names what to send): a local revision, or the online copy's tracking ref.
 */
async function sendRef(
  dir: string,
  { transport, http }: Online,
  ref: string,
  remoteName: string,
  remove = false,
): Promise<void> {
  await git.push({
    fs,
    http,
    dir,
    remote: transport.remote,
    ref,
    remoteRef: `refs/heads/${remoteName}`,
    delete: remove,
    ...onAuthFor(transport.credential),
  });
  // The push forgets the tracking ref under a doubled slash, which a ref kept in
  // packed-refs (as other Git tools leave them) never matches: name it properly.
  if (remove) await git.deleteRef({ fs, dir, ref: `refs/remotes/${transport.remote}/${remoteName}` });
}

/**
 * Rename a revision. The open revision may be renamed (the book stays open on it).
 *
 * One that is also in the online copy is renamed there too, in an order that
 * never loses anything, so each failure leaves a known state:
 *  1. send the new name online — a failure leaves everything as it was;
 *  2. remove the old name online — a failure removes the new name again, so
 *     everything is as it was; only if that can't be done either (the network
 *     dropped between the two) does the online copy keep both names, which the
 *     error says;
 *  3. rename on this computer — only a local failure is possible here, and it
 *     leaves the online copy renamed and this computer under the old name, still
 *     listed (the new name shows as online-only).
 * A revision kept only in the online copy is renamed there (steps 1 and 2), with
 * the tracking ref (what this computer last heard) standing in for its tip.
 * Offline or a rejected sign-in: nothing is renamed, anywhere.
 */
export async function renameRevision(
  options: RenameRevisionOptions,
): Promise<{ current: string | null; name: string }> {
  const source = await detectProjectSource(options.projectDir);
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
  const dir = gitScopeFor(source);
  const { from } = options;
  const to = revisionNameFrom(options.to);
  return withRepoLock(dir, async () => {
    const refs = await readRevisionRefs(dir);
    const onlineOnly = !refs.local.has(from) && refs.online.has(from);
    const tip = onlineOnly ? refs.online.get(from)! : localTip(refs, from);
    const current = refs.current === from ? to : refs.current;
    if (to === from) return { current, name: to };
    await assertFreeRevisionName(dir, to);

    const unchanged = `"${from}" wasn't renamed`;
    // Getting the latest brings in the open revision only.
    const catchUp = onlineOnly
      ? `They arrived after the list was last checked, so ${unchanged}. Try again.`
      : `${refs.current === from ? "Get" : `Switch to "${from}" and get`} the latest first, then try again.`;
    const online = refs.online.has(from)
      ? await reachOnline(dir, from, tip, catchUp, options, unchanged)
      : null;
    if (onlineOnly && !online) {
      throw new Error(`Couldn't find a revision named "${from}" in the online copy — it may have been renamed or deleted.`);
    }
    if (online) {
      const here = onlineOnly ? `refs/remotes/${online.transport.remote}/${from}` : `refs/heads/${from}`;
      try {
        await sendRef(dir, online, here, to);
      } catch (e) {
        throw onlineFailure(e, unchanged);
      }
      try {
        await sendRef(dir, online, here, from, true);
      } catch (e) {
        // Take the new name back, so the online copy is as it was. The tracking
        // ref the send just wrote is what names it here.
        const undone = await sendRef(dir, online, `refs/remotes/${online.transport.remote}/${to}`, to, true).then(
          () => true,
          () => false,
        );
        throw undone
          ? onlineFailure(e, unchanged)
          : new Error(
              `"${from}" couldn't be renamed in the online copy, which now has both "${from}" and "${to}". ` +
                `Your work is safe on this computer. Delete the one you don't want, or try again later.`,
              { cause: e },
            );
      }
    }
    if (!onlineOnly) await git.renameBranch({ fs, dir, ref: to, oldref: from });
    return { current, name: to };
  });
}

/**
 * How many versions of `tip` are in none of `others`, like
 * `git rev-list tip --not others`: commits are taken newest first, a version
 * reached from any of `others` is shared (and so is everything before it), and
 * the walk stops once only shared history is left or after `limit` commits —
 * a long unshared history is reported as at least that many.
 */
async function countVersionsOnlyIn(
  dir: string,
  tip: string,
  others: string[],
  limit = 5000,
): Promise<number> {
  const cache: GitCache = {};
  type Reached = { time: number; parents: string[]; shared: boolean };
  const waiting = new Map<string, Reached>();
  const visited = new Set<string>();
  // An unreadable version (a shallow edge, a missing object) simply ends its line of history.
  const reach = async (oid: string, shared: boolean) => {
    const known = waiting.get(oid);
    if (known) {
      known.shared ||= shared;
      return;
    }
    if (visited.has(oid)) return;
    const read = await git.readCommit({ fs, dir, cache, oid }).catch(() => undefined);
    if (read) {
      waiting.set(oid, { time: read.commit.committer.timestamp, parents: read.commit.parent, shared });
    }
  };
  // An unreadable tip is a damaged book, not "nothing to lose".
  await git.readCommit({ fs, dir, cache, oid: tip });
  await reach(tip, false);
  for (const oid of others) await reach(oid, true);
  let onlyHere = 0;
  for (let walked = 0; walked < limit; walked++) {
    const entries = [...waiting];
    if (entries.every(([, v]) => v.shared)) break;
    const [oid, version] = entries.reduce((a, b) => (b[1].time > a[1].time ? b : a));
    waiting.delete(oid);
    visited.add(oid);
    if (!version.shared) onlyHere++;
    for (const parent of version.parents) await reach(parent, version.shared);
  }
  return onlyHere;
}

/**
 * Delete a revision. Never the open one. By default only on this computer
 * (a copy in the online copy stays, and shows as online-only); `everywhere`
 * removes it from the online copy first, then here — a failure online leaves
 * everything as it was, a failure here leaves it removed online and still
 * listed on this computer. A revision kept only in the online copy has nothing
 * here to remove: it is deleted from the online copy, as `everywhere` does, with
 * the tracking ref (what this computer last heard) standing in for its tip.
 *
 * Nothing found only in the revision is deleted without a second look: when it
 * holds versions found in no other revision (and, unless deleted everywhere, not
 * in the online copy), the first call returns how many and deletes nothing; the
 * caller asks and calls again with `discard: true`.
 */
export async function deleteRevision(
  options: DeleteRevisionOptions,
): Promise<{ deleted: true } | { deleted: false; versionsOnlyHere: number }> {
  const source = await detectProjectSource(options.projectDir);
  if (source.type !== "local-git-folder") throw new Error(NO_VERSION_HISTORY);
  const dir = gitScopeFor(source);
  const { name } = options;
  return withRepoLock(dir, async () => {
    const refs = await readRevisionRefs(dir);
    if (name === refs.current) {
      throw new Error(
        `You're working on "${name}" right now. Switch to another revision first, then delete it.`,
      );
    }
    const onlineOnly = !refs.local.has(name) && refs.online.has(name);
    const tip = onlineOnly ? refs.online.get(name)! : localTip(refs, name);
    const everywhere = onlineOnly || (options.everywhere === true && refs.online.has(name));
    const unchanged = `"${name}" wasn't deleted`;
    const catchUp = onlineOnly
      ? `They arrived after the list was last checked, so ${unchanged}. Try again.`
      : `Switch to "${name}" and get the latest first, then try again.`;
    const online = everywhere ? await reachOnline(dir, name, tip, catchUp, options, unchanged) : null;

    if (!options.discard) {
      const others = [
        ...[...refs.local].filter(([n]) => n !== name),
        ...[...refs.online].filter(([n]) => !(everywhere && n === name)),
      ].map(([, otherTip]) => otherTip);
      const versionsOnlyHere = await countVersionsOnlyIn(dir, tip, others);
      if (versionsOnlyHere > 0) return { deleted: false, versionsOnlyHere };
    }

    if (online) {
      const ref = onlineOnly ? `refs/remotes/${online.transport.remote}/${name}` : `refs/heads/${name}`;
      try {
        await sendRef(dir, online, ref, name, true);
      } catch (e) {
        throw onlineFailure(e, unchanged);
      }
    }
    if (!onlineOnly) await git.deleteBranch({ fs, dir, ref: name });
    return { deleted: true };
  });
}
