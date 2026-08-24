/**
 * Author-language copy for sync (never raw git words). Extracted from sync.ts
 * so the transport and orchestrator modules share ONE source of these
 * strings — their exact wording is part of the observable contract (the host
 * renders them verbatim).
 */

export const MSG_UP_TO_DATE = "Everything is in sync.";
export const MSG_UP_TO_DATE_PULLED =
  "Everything is in sync. The latest online changes were downloaded to this computer.";
export const MSG_SYNCED = "Your changes are online.";
export const MSG_SYNCED_MERGED =
  "Your changes are online, combined with changes from the online copy.";
export const MSG_OFFLINE =
  "Your changes are saved on this computer. gutterpress couldn't reach the online repository — try syncing again when you're back online.";
export const MSG_AUTH =
  "The online repository didn't accept the saved connection. Reconnect and try again.";
// No literal scheme tokens ("http://") in this copy: the desktop's Advanced
// Setup dialog redacts anything matching /https?:\/\/\S+/, which would garble
// the message. Say "https", never "https://".
export const MSG_INSECURE_TRANSPORT =
  "This project's online address isn't secure, so the saved connection wasn't sent — connections are never sent over an insecure address. Switch the address to a secure one (starting with https), or to a local loopback address for a server on this computer, to sync.";
export const MSG_BUSY =
  "The online copy is changing very quickly right now. Your work is saved on this computer — try Sync again in a moment.";
export const MSG_UNRELATED =
  "The online address points at a different project's files, so the two can't be combined. Check the project's online address.";
export const MSG_NO_REMOTE =
  "This project isn't connected to an online repository yet.";
export const MSG_SSH_REMOTE =
  "This project's online address uses SSH (git@…), which gutterpress can't sync to. Switch it to the web (HTTPS) address to sync from here.";
export const MSG_NO_BRANCH =
  "This project's version history isn't on a named branch, so it can't be synced right now.";
// The two messages below are recorded VERBATIM as commit messages, so a
// writer sees them raw on github.com and classified in the desktop's
// Previous versions timeline (version-timeline.ts matches them as literal
// strings — including every superseded spelling, which existing history
// keeps forever). Rename only with a matching timeline entry, and never into
// version-control vocabulary.
/** Message recorded on the automatic pre-sync snapshot (D5 invariant).
 *  Pre-0.10.1 history carries the old spelling "Snapshot before syncing". */
export const SYNC_SNAPSHOT_MESSAGE = "Automatic backup of your work";
/**
 * Message recorded when an edit reached disk while the fetch was in flight —
 * after the pre-sync snapshot, before the merge (see the re-snapshot in
 * `syncProject`). Distinct wording so the race is legible in history; the
 * copy is already writer-voiced, so it deliberately stays unchanged (every
 * rename permanently grows the timeline's superseded-spelling list).
 */
export const SYNC_LATE_EDIT_MESSAGE = "Saved the edit you made while syncing";

/**
 * The keep-both sibling contract, kept HERE rather than in converge-merge.ts
 * because every consumer needs it and converge-merge pulls in isomorphic-git:
 * the markdown file resolver must not render a sibling as a chapter, and the
 * merge-marker check must report it. This file imports nothing, so any of
 * them can depend on it.
 *
 * `art/cover.png` -> `art/cover.online.png`; extensionless `NOTES` -> `NOTES.online`.
 */
export function onlineSiblingPath(filepath: string): string {
  const dot = filepath.lastIndexOf(".");
  const slash = filepath.lastIndexOf("/");
  const hasExt = dot > slash + 1;
  return hasExt ? `${filepath.slice(0, dot)}.online${filepath.slice(dot)}` : `${filepath}.online`;
}

/** True for a path `onlineSiblingPath` produced — Gutterpress's artifact, not the author's. */
export function isOnlineSibling(filepath: string): boolean {
  const dot = filepath.lastIndexOf(".");
  const slash = filepath.lastIndexOf("/");
  const stem = dot > slash + 1 ? filepath.slice(0, dot) : filepath;
  return stem.endsWith(".online");
}
