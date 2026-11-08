/**
 * The top card of Book setup → Online: one title, one line and one
 * primary action for each situation the book can be in (UX review §5's table).
 * Pure, so the whole table is unit-tested. ProjectConnectionsSection draws it.
 *
 * Inputs the host may not send yet (`ahead`, `behind`, `decide`, a "not-found"
 * outcome) are optional: without them the card falls back to the states the
 * host does report (safe, not backed up yet, offline, sign-in, paused).
 */
import { draftName } from "#lib/revision-name.ts";
import type { BackupState } from "#lib/backup-state.ts";

import { agoFull } from "#lib/format.ts";
export { agoFull };
const relativeTime = agoFull;

export type CardTone = "ok" | "warn" | "pending" | "plain";
export type CardIcon = "circle-check" | "triangle-alert" | "refresh-cw" | "cloud-upload" | "cloud-download" | "cloud-off" | "cloud" | "laptop" | "history" | "info" | "key-round";
/** What the one primary button does; the section maps each to its own handler. */
export type CardAction =
  | "turn-on-versions"
  | "set-up-backup"
  | "back-up"
  | "get-changes"
  | "update"
  | "try-again"
  | "sign-in"
  | "review-decisions"
  | "check-address"
  | null;

export interface CardInput {
  situation: BackupState;
  /** The host's last word: a SyncStatus (state names as sent), plus the optional newer fields. */
  backup: { state: string; lastSyncAt: string | null; message?: string; ahead?: number; behind?: boolean; decide?: number } | null;
  /** The online copy is being checked right now (the shared snapshot). */
  checking: boolean;
  /** "GitHub · ada/harbor-lights", or the server's name. */
  where: string;
  /** The "Sign in" step needs the GitHub flow (true) or a server's form (false). */
  github: boolean;
  autoBackup: boolean;
  now: number;
  /** The book's title, for sentences about its online copy. */
  bookName?: string;
  /** Where the drafts are kept: whether the open one is online, and how many others are only on this computer. */
  drafts?: { currentBackedUp: boolean; othersOnlyHere: number };
}

export interface CardView {
  icon: CardIcon;
  tone: CardTone;
  title: string;
  detail: string;
  action: CardAction;
  /** A second button beside the primary one ("Sign in again" beside "Check the address"). */
  secondary?: CardAction;
  /** A muted line under the detail ("1 other draft is only on this computer."). */
  note?: string;
  /** The detail ends with when the online copy was last checked (safe, ahead and behind). */
  showChecked?: boolean;
}

/** A host message as one plain sentence, or null when it looks technical (a path, a URL, a code, very long). */
function plainSentence(m: string | undefined): string | null {
  const t = (m ?? "").replace(/\s+/g, " ").trim();
  if (!t || t.length > 140 || /https?:|[\\/]\w+\/|\b[A-Z_]{4,}\b|\bat \S+:\d+/.test(t)) return null;
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "20 seconds ago" under a minute, then "3 minutes ago" (the one time helper for the tab). */
export function checkedAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} seconds ago`;
  return agoFull(at, now);
}

export function backupCard(i: CardInput): CardView {
  switch (i.situation) {
    case "no-versions":
      return { icon: "history", tone: "plain", title: "Version history is off", detail: "Turn it on to keep earlier versions on this computer, so you can go back. Nothing is uploaded.", action: "turn-on-versions" };
    case "local-only":
      return {
        icon: "laptop",
        tone: "plain",
        title: "Not online yet",
        detail: "Your book is saved on this computer only. If this computer is lost or broken, so is your book. An online copy on GitHub keeps it safe, free.",
        action: "set-up-backup",
      };
    case "connect-github":
    case "connect-server":
      return { icon: "key-round", tone: "warn", title: "Sign in to send", detail: `This book's online copy is at ${i.where}. Sign in so Gutterpress can keep it up to date. Your work is safe on this computer.`, action: "sign-in" };
    case "own-tools":
      return { icon: "info", tone: "plain", title: "Kept online with your own tool", detail: "This book's online copy uses an address Gutterpress can't send to. Keep using your usual tool for it.", action: null };
    case "ready":
      break;
  }

  const b = i.backup;
  const state = b?.state;
  // The host's own `reason` first; the wording regex only for an older host that sends none.
  const reason = (b as { reason?: string } | null)?.reason;
  const lost = state === "not-found" || (state === "error" && (reason === "not-found" || (reason === undefined && /can'?t find/i.test(b?.message ?? ""))));
  const onGitHub = i.github || (b as { host?: string } | null)?.host === "github";
  if ((b?.decide ?? 0) > 0) {
    const n = b!.decide!;
    return { icon: "triangle-alert", tone: "warn", title: `${plural(n, "passage needs", "passages need")} your decision`, detail: "The same passage was changed here and online. Nothing is lost. Your work is safe on this computer.", action: "review-decisions" };
  }
  if (state === "auth") {
    return {
      icon: "key-round",
      tone: "warn",
      title: "Your saved sign-in no longer works",
      detail: `${i.bookName ? `The online copy of "${i.bookName}"` : `The online copy at ${i.where}`} no longer accepts it. Sign in again to keep sending changes. Your work is safe on this computer.`,
      action: "sign-in",
    };
  }
  if (lost) {
    return { icon: "triangle-alert", tone: "warn", title: "Can't find the online copy", detail: `It may have been renamed or deleted, or your account may not have access.${onGitHub ? " On GitHub that often means Gutterpress needs you to sign in again." : ""} Your work is safe on this computer.`, action: "check-address", ...(onGitHub ? { secondary: "sign-in" as const } : {}) };
  }
  if (state === "offline") {
    return { icon: "cloud-off", tone: "plain", title: "You're offline", detail: "Your work is saved here and will send when you're back online.", action: "try-again" };
  }
  if (state === "error") {
    return { icon: "triangle-alert", tone: "warn", title: "Sending paused", detail: `${plainSentence(b?.message) ?? "Gutterpress couldn't send just now."} Your work is safe on this computer.`, action: "try-again" };
  }
  const ahead = b?.ahead ?? 0;
  const behind = b?.behind === true;
  if (behind && ahead > 0) {
    return { icon: "cloud", tone: "pending", title: "Changes here and online", detail: "Gutterpress will combine them. If the same passage changed in both places, you will choose which to keep.", action: "update" };
  }
  if (behind) {
    return { icon: "cloud-download", tone: "pending", title: "New changes are online", detail: "Someone (or another computer) changed this book. Your own changes stay as they are.", action: "get-changes", showChecked: true };
  }
  if (ahead > 0) {
    return { icon: "cloud-upload", tone: "warn", title: `${plural(ahead, "change isn't", "changes aren't")} online yet`, detail: "They're saved on this computer.", action: "back-up", showChecked: true };
  }
  if (state === "syncing") {
    return { icon: "refresh-cw", tone: "pending", title: "Sending…", detail: i.autoBackup ? "Gutterpress sends your changes as you work." : "Sending your latest work to the online copy.", action: null };
  }
  const at = Date.parse(b?.lastSyncAt ?? "");
  const known = !Number.isNaN(at);
  if (i.checking && state !== "synced" && state !== "up-to-date") {
    return { icon: "refresh-cw", tone: "pending", title: "Checking your online copy…", detail: known ? `Last known: sent ${relativeTime(at, i.now)}.` : "Your work is saved on this computer.", action: null };
  }
  if (!b || (state !== "synced" && state !== "up-to-date" && state !== "unsent")) {
    // Nothing heard yet (the host reports once its first pass has run), or only that nothing has run: say what is known, offer the one action.
    return { icon: "cloud", tone: "plain", title: "Your online copy is set up", detail: `Kept at ${i.where}. ${i.autoBackup ? "Gutterpress sends your changes as you work." : "Sending automatically is off."}`, action: "back-up" };
  }
  if (state === "unsent") {
    return { icon: "cloud-upload", tone: "warn", title: "Not online yet", detail: i.autoBackup ? "Your latest work is saved here and Gutterpress will send it soon." : "Your latest work is saved here. Send it when you're ready.", action: "back-up" };
  }
  if (i.drafts && !i.drafts.currentBackedUp) {
    return { icon: "cloud-upload", tone: "warn", title: "This draft isn't online yet", detail: "Your work is saved on this computer. Send now to keep it safe online.", action: "back-up" };
  }
  const when = known ? `Last sent ${relativeTime(at, i.now)} to ${i.where}.` : `Kept at ${i.where}.`;
  return { icon: "circle-check", tone: "ok", title: "Your book is safe online", detail: i.autoBackup ? `${when} Gutterpress sends your changes as you work.` : `${when} Sending automatically is off.`, action: "back-up", showChecked: true, ...(i.drafts?.othersOnlyHere ? { note: `${plural(i.drafts.othersOnlyHere, "other draft is", "other drafts are")} only on this computer.` } : {}) };
}

/**
 * What a repair would set aside, as the confirm says it (`setAside` is the host's preview; null when it has none).
 * A repair moves this book's whole old version history into a safety folder outside the book and starts from
 * the online copy's, so what exists only here leaves the book's history. It is kept, not deleted.
 */
export function repairSetAsideText(setAside: { revisions: string[]; versions: number } | null, savedCopies = 0): string {
  const copies = savedCopies > 0 ? ` The ${savedCopies === 1 ? "saved copy" : `${savedCopies} saved copies`} from earlier repairs go${savedCopies === 1 ? "es" : ""} into the safety folder too.` : "";
  const KEPT = "It stays in a safety folder outside your book. It is not deleted, but it won't show in your book's history.";
  // The current draft, if only here, keeps its files and name: only its earlier history goes aside.
  const DRAFT = " If the draft you are on is one of them, its current files stay and are sent online as that draft; only its earlier history goes to the safety folder.";
  if (!setAside) {
    return `Anything that exists only on this computer, such as a draft or versions that were never sent online, is set aside too. ${KEPT}${DRAFT}${copies}`;
  }
  const { revisions, versions } = setAside;
  if (revisions.length === 0 && versions === 0) return `Everything on this computer is already online, so nothing would be lost from your history.${copies}`;
  const parts = [
    revisions.length ? `${revisions.length} ${revisions.length === 1 ? "draft" : "drafts"} (${revisions.map((n) => `"${draftName(n)}"`).join(", ")})` : "",
    versions ? `${versions} ${versions === 1 ? "version" : "versions"}` : "",
  ].filter(Boolean);
  return `This will set aside ${parts.join(" and ")} that ${revisions.length + versions === 1 ? "is" : "are"} only on this computer. ${KEPT}${revisions.length ? DRAFT : ""}${copies}`;
}
