/**
 * Author-language copy for sync / pull / push / conflict-resolution (never raw
 * git words). Extracted from sync.ts so the transport, conflict-resolution and
 * orchestrator modules share ONE source of these strings — their exact wording
 * is part of the observable contract (the host renders them verbatim).
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
export const MSG_PULLED =
  "The latest online changes were downloaded to this computer.";
export const MSG_PULLED_MERGED =
  "The latest online changes were combined with your changes on this computer.";
export const MSG_PULL_UP_TO_DATE = "You already have the latest online changes.";
export const MSG_PUSH_UP_TO_DATE = "There's nothing new to send — everything is already online.";
export const MSG_PULL_FIRST =
  "The online copy has changes you don't have yet. Get the latest changes first, then send yours.";
/** Message recorded on the automatic pre-sync snapshot (D5 invariant). */
export const SYNC_SNAPSHOT_MESSAGE = "Snapshot before syncing";
