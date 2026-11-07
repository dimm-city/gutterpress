/**
 * The top card of Book setup → Backup & history: one title, one line and one
 * primary action for each situation the book can be in (UX review §5's table).
 * Pure, so the whole table is unit-tested. ProjectConnectionsSection draws it.
 *
 * Inputs the host may not send yet (`ahead`, `behind`, `decide`, a "not-found"
 * outcome) are optional: without them the card falls back to the states the
 * host does report (safe, not backed up yet, offline, sign-in, paused).
 */
import type { BackupState } from "#lib/backup-state.ts";
import { relativeTime } from "#lib/format.ts";

export type CardTone = "ok" | "warn" | "pending" | "plain";
export type CardIcon = "circle-check" | "triangle-alert" | "refresh-cw" | "cloud-upload" | "cloud-download" | "cloud-off" | "cloud" | "laptop" | "history" | "info" | "key";
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
}

export interface CardView {
  icon: CardIcon;
  tone: CardTone;
  title: string;
  detail: string;
  action: CardAction;
  /** A second button beside the primary one ("Sign in again" beside "Check the address"). */
  secondary?: CardAction;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "20 s ago" under a minute, then the usual "3 mins ago". */
export function checkedAgo(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  return relativeTime(at, now);
}

export function backupCard(i: CardInput): CardView {
  switch (i.situation) {
    case "no-versions":
      return { icon: "history", tone: "plain", title: "Version history is off", detail: "Turn it on to keep earlier versions on this computer, so you can go back. Nothing is uploaded.", action: "turn-on-versions" };
    case "local-only":
      return {
        icon: "laptop",
        tone: "plain",
        title: "Not backed up online yet",
        detail: "Your book is saved on this computer only. If this computer is lost or broken, so is your book. An online copy on GitHub keeps it safe, free.",
        action: "set-up-backup",
      };
    case "connect-github":
    case "connect-server":
      return { icon: "key", tone: "warn", title: "Sign in to back up", detail: `This book's online copy is at ${i.where}. Sign in so Gutterpress can keep it up to date.`, action: "sign-in" };
    case "own-tools":
      return { icon: "info", tone: "plain", title: "Backed up with your own tool", detail: "This book's online copy uses an address Gutterpress can't back up to. Keep using your usual tool for it.", action: null };
    case "ready":
      break;
  }

  const b = i.backup;
  const state = b?.state;
  const lost = state === "not-found" || (state === "error" && /can'?t find/i.test(b?.message ?? ""));
  if ((b?.decide ?? 0) > 0) {
    const n = b!.decide!;
    return { icon: "triangle-alert", tone: "warn", title: `${plural(n, "passage needs", "passages need")} your decision`, detail: "The same passage was changed here and online.", action: "review-decisions" };
  }
  if (state === "auth") {
    return {
      icon: "key",
      tone: "warn",
      title: "Sign in again to keep backing up",
      detail: i.github ? `GitHub no longer accepts the saved sign-in for ${i.where}.` : `The online copy at ${i.where} no longer accepts your saved sign-in.`,
      action: "sign-in",
    };
  }
  if (lost) {
    return { icon: "triangle-alert", tone: "warn", title: "Can't find the online copy", detail: "It may have been renamed or deleted, or your account may not have access.", action: "check-address", secondary: "sign-in" };
  }
  if (state === "offline") {
    return { icon: "cloud-off", tone: "plain", title: "Can't reach the online copy", detail: "Your work is saved here and will back up when you're back online.", action: "try-again" };
  }
  if (state === "error") {
    return { icon: "triangle-alert", tone: "warn", title: "Backup paused", detail: `${(b?.message ?? "").trim() || "Backing up hit a problem."} Your work is safe on this computer.`.replace(/\s+/g, " "), action: "try-again" };
  }
  const ahead = b?.ahead ?? 0;
  const behind = b?.behind === true;
  if (behind && ahead > 0) {
    return { icon: "cloud", tone: "pending", title: "Changes here and online", detail: "Gutterpress will combine them. If the same passage changed in both places, you will choose which to keep.", action: "update" };
  }
  if (behind) {
    return { icon: "cloud-download", tone: "pending", title: "New changes are online", detail: "Someone (or another computer) changed this book. Your own changes stay as they are.", action: "get-changes" };
  }
  if (ahead > 0) {
    return { icon: "cloud-upload", tone: "warn", title: `${plural(ahead, "change isn't", "changes aren't")} backed up yet`, detail: "They're saved on this computer.", action: "back-up" };
  }
  if (state === "syncing") {
    return { icon: "refresh-cw", tone: "pending", title: "Backing up…", detail: i.autoBackup ? "Gutterpress backs up as you work." : "Sending your latest work to the online copy.", action: null };
  }
  const at = Date.parse(b?.lastSyncAt ?? "");
  const known = !Number.isNaN(at);
  if (i.checking && state !== "synced" && state !== "up-to-date") {
    return { icon: "refresh-cw", tone: "pending", title: "Checking your online copy…", detail: known ? `Last known: backed up ${relativeTime(at, i.now)}.` : "Your work is saved on this computer.", action: null };
  }
  if (!b || (state !== "synced" && state !== "up-to-date" && state !== "unsent")) {
    // Nothing heard yet (the host reports once its first pass has run), or only that nothing has run: say what is known, offer the one action.
    return { icon: "cloud", tone: "plain", title: "Your online copy is set up", detail: `Kept at ${i.where}. ${i.autoBackup ? "Gutterpress backs up as you work." : "Backing up automatically is off."}`, action: "back-up" };
  }
  if (state === "unsent") {
    return { icon: "cloud-upload", tone: "warn", title: "Not backed up yet", detail: i.autoBackup ? "Your latest work is saved here and Gutterpress will back it up soon." : "Your latest work is saved here. Back it up when you're ready.", action: "back-up" };
  }
  const when = known ? `Last backed up ${relativeTime(at, i.now)} to ${i.where}.` : `Kept at ${i.where}.`;
  return { icon: "circle-check", tone: "ok", title: "Your book is safe online", detail: i.autoBackup ? `${when} Gutterpress backs up as you work.` : `${when} Backing up automatically is off.`, action: "back-up" };
}

/** What a repair would set aside, as the confirm says it (`setAside` is the host's preview; null when it has none). */
export function repairSetAsideText(setAside: { revisions: string[]; versions: number } | null): string {
  const SEE = 'They are kept in a repair copy you can bring back: see "Saved copies after a repair" under Drafts.';
  if (!setAside) {
    return `Anything that isn't online yet, such as a draft or versions only on this computer, is set aside too. ${SEE}`;
  }
  const { revisions, versions } = setAside;
  if (revisions.length === 0 && versions === 0) return "Everything on this computer is already online, so nothing would be set aside.";
  const name = (n: string) => `"${n === "main" || n === "master" ? "Main draft" : n.replace(/-+/g, " ")}"`;
  const parts = [
    revisions.length ? `${revisions.length} ${revisions.length === 1 ? "draft" : "drafts"} (${revisions.map(name).join(", ")})` : "",
    versions ? `${versions} ${versions === 1 ? "version" : "versions"}` : "",
  ].filter(Boolean);
  return `This will set aside ${parts.join(" and ")} that ${revisions.length + versions === 1 ? "is" : "are"} only on this computer. ${SEE}`;
}
