/**
 * Author-language copy for backing up and getting the latest — never sync,
 * push, pull, repository, branch or snapshot. Extracted from sync.ts so the
 * transport and orchestrator modules share ONE source of these strings — their
 * exact wording is part of the observable contract (the host renders them
 * verbatim).
 */

export const MSG_UP_TO_DATE = "You're up to date with the online copy.";
export const MSG_UP_TO_DATE_PULLED =
  "You're up to date. The latest changes from the online copy were downloaded to this computer.";
export const MSG_SYNCED = "Your changes are online.";
export const MSG_SYNCED_MERGED =
  "Your changes are online, combined with changes from the online copy.";
export const MSG_OFFLINE =
  "Your changes are saved on this computer. Gutterpress couldn't reach the online copy — try again when you're back online.";
export const MSG_AUTH =
  "The online copy didn't accept the saved sign-in. Sign in again and try again.";
// No literal scheme tokens ("http://") in this copy: the desktop's Advanced
// Setup dialog redacts anything matching /https?:\/\/\S+/, which would garble
// the message. Say "https", never "https://".
export const MSG_INSECURE_TRANSPORT =
  "This book's online copy is at an address that isn't secure, so the saved sign-in wasn't sent — sign-ins are never sent over an insecure address. Switch the address to a secure one (starting with https), or to a local loopback address for a server on this computer, to back up.";
export const MSG_BUSY =
  "The online copy is changing very quickly right now. Your work is saved on this computer — try again in a moment.";
/**
 * The book's own versions are unreadable — a damaged or missing `.git`. Says
 * the three things that are actually true and useful: the writing is safe, the
 * VERSIONS are what broke, and (backing up always has an online copy, so this
 * always applies here) "Repair the online copy" is the way back.
 */
export const MSG_HISTORY_UNREADABLE =
  "This book's versions can't be read, so backing up can't continue. Your writing is safe — every file is still here on this computer. Use \"Repair the online copy\" in Book setup to get versions and backing up working again.";
// Two DIFFERENT causes produce "no versions in common", and the message must
// not assert one of them: the online copy's address may point at a different
// book, or this book's own versions may have been lost and started over. Naming
// both beats sending a writer whose versions are gone to inspect a correct address.
export const MSG_UNRELATED =
  "This book and the online copy have no versions in common, so they can't be combined. Either the online copy's address points at a different book, or this book's own versions were lost and started over. Your writing is safe — every file is still here on this computer. Check the online copy's address; if it is correct, use \"Repair the online copy\" in Book setup.";
export const MSG_NO_REMOTE =
  "This book doesn't have an online copy yet.";
export const MSG_SSH_REMOTE =
  "This book's online copy uses an SSH address (git@…), which Gutterpress can't back up to. Switch it to the web (HTTPS) address to back up from here.";
export const MSG_NO_BRANCH =
  "This book isn't on a named revision, so it can't be backed up right now.";
// The two messages below are recorded VERBATIM as version messages, so a
// writer sees them raw on github.com and classified in the desktop's
// Version history timeline (version-timeline.ts matches them as literal
// strings — including every superseded spelling, which existing history
// keeps forever). Rename only with a matching timeline entry, and never into
// version-control vocabulary.
/** Message recorded on the automatic version saved before backing up (D5 invariant).
 *  Older history carries the spellings "Automatic backup of your work" and,
 *  before 0.10.1, "Snapshot before syncing". */
export const SYNC_SNAPSHOT_MESSAGE = "Automatic version before backing up";
/**
 * Message recorded when an edit reached disk while the fetch was in flight —
 * after the pre-backup version, before the merge (see the re-snapshot in
 * `syncProject`). Distinct wording so the race is legible in history. Older
 * history carries the spelling "Saved the edit you made while syncing".
 */
export const SYNC_LATE_EDIT_MESSAGE = "Saved the edit you made while backing up";

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
