/**
 * save-status.ts — the pure state → words mapping behind the status bar's one
 * status control, and the "Saved · last version 10 minutes ago" line in Book
 * setup → Online copy.
 *
 * The control folds two clocks into one line: your typing written to this
 * computer ("Saved"), and where the book stands in its online copy ("Backed
 * up"). A shape carries the tone, never colour alone. Vocabulary:
 * docs/ux-design-contract.md.
 *
 * Pure: no DOM, no host imports, no clock reads (callers pass `now`). Never
 * claims a fact it wasn't given.
 */
import { agoFull, relativeTime } from "./format";
import type { SyncState } from "./platform/contract";

/** The online copy's last word. `not-found` is the online copy's address leading nowhere (the host's 404 outcome). */
export type BackupSyncState = SyncState | "not-found";

export interface StatusBackup {
  state: BackupSyncState;
  message?: string;
  /** The host's machine-readable cause for an `error` (`not-found`), preferred over matching the message. */
  reason?: string;
  /** `github` when the online copy is on GitHub, where a 404 usually means no access. */
  host?: string;
  /** ISO time of the last finished pass. */
  lastSyncAt?: string | null;
  /** Versions on this computer the online copy lacks (the host, when it counted). */
  ahead?: number;
  /** The online copy has changes this computer lacks (the host, when it checked). */
  behind?: boolean;
  /** Passages with two takes waiting for a decision (the host, when it counted). */
  decide?: number;
  /** The answer came from local records only; the network pass has not confirmed it yet. */
  local?: boolean;
}

export interface StatusLineInput {
  /** Editor buffer save phase. */
  savePhase: "clean" | "dirty" | "saving" | "error";
  /** Settings → Saving "Save changes automatically". */
  autoSave: boolean;
  /** A manual Save is in progress. */
  forceSaving: boolean;
  /** Why the last save failed, when the editor said. */
  saveError?: string | null;
  /** The platform's save shortcut as written ("Ctrl+S", "Cmd+S"). */
  saveKey?: string;
  /** The host said automatic versions keep failing (and why). */
  versionsProblem: { message: string | null } | null;
  /** The online copy's last word: the host's stream or the last manual pass (`null` until the first). */
  backup: StatusBackup | null;
  /** The book has an online copy at all (any address), so an unknown state is not "only on this computer". */
  hasRemote: boolean;
  /** A manual Back up / Update is in progress. */
  backingUp: boolean;
  /** A manual "get the changes" is in progress. */
  gettingLatest?: boolean;
  /** The book was classified (so "no online copy" is a fact, not a gap in what we know yet). */
  classified?: boolean;
  /** The folder keeps no version history (a plain folder). */
  noHistory?: boolean;
  /** The remote diagnosis says what the online copy needs: a sign-in, or nothing Gutterpress can do (your own tools). */
  remoteNeeds?: "sign-in" | "own-tools" | null;
  /** The last check for online changes found some (manual mode). */
  updatesAvailable?: boolean;
  /** The renderer's own check for online changes has answered once. */
  checked?: boolean;
  /** Passages with two takes (counted from the Problems list). */
  decide?: number;
  /** The Problems list has loaded, so its count beats a host count that may be stale. */
  problemsLoaded?: boolean;
  /** Settings → Saving "Back up online automatically". */
  autoBackup?: boolean;
  /** The book can back up (an https online copy with a saved sign-in). */
  canSync?: boolean;
  /** Clock, for "3 minutes ago". */
  now?: number;
}

export type StatusKey =
  | "saving"
  | "unsaved"
  | "save-failed"
  | "versions-failing"
  | "decide"
  | "offline"
  | "sign-in"
  | "not-found"
  | "paused"
  | "own-tools"
  | "behind"
  | "behind-ahead"
  | "ahead"
  | "backing-up"
  | "checking"
  | "backed-up"
  | "nothing-new"
  | "no-online"
  | "no-history"
  | "unknown";

/** What a click, or a button in the popover, does. The page maps each to a handler. */
export type StatusActionId =
  | "save"
  | "back-up"
  | "get-changes"
  | "update"
  | "try-again"
  | "open-backup"
  | "turn-on-history"
  | "save-version"
  | "open-problems";

export interface StatusAction {
  id: StatusActionId;
  label: string;
}

export interface StatusLine {
  key: StatusKey;
  /** The whole line as one string ("Saved here · Backed up 3 minutes ago"). */
  text: string;
  /** The "this computer" clause; absent when the state is the whole story (Saving…, Unsaved changes). */
  left?: string;
  /** The "online copy" clause, or the whole text when there is no left clause. */
  right: string;
  /** The same line without a time, so a minute ticking over is not announced. */
  announce: string;
  /** The popover's short headline: a sentence-case line, not an echo of the bar. */
  headline: string;
  /** The tooltip: what it means and what a click does. */
  title: string;
  /** The popover's sentence. */
  detail: string;
  icon: "circle-check" | "refresh-cw" | "pen-line" | "cloud-upload" | "triangle-alert" | "circle-x" | "cloud" | "cloud-download" | "cloud-off" | "key-round" | "laptop" | "history";
  /** `pending` is in flight (a spinner); `warn` needs the author; `error` is a failed save; `plain` is information. */
  tone: "ok" | "pending" | "warn" | "error" | "plain";
  /** What a click on the status does: do the fix, open the popover, or nothing. */
  click: "action" | "popover" | "none";
  /** The action behind `click: "action"`. */
  clickAction?: StatusActionId;
  /** The popover's one primary action, if any. */
  primary?: StatusAction;
  /** The primary is a quiet outline button: nothing is wrong, the action is optional. */
  primaryQuiet?: boolean;
  /** A second, quieter popover action. */
  secondary?: StatusAction;
  /** The bar's own button, only when there is something to get or send (or a pass is running). */
  button?: { label: "Get changes" | "Back up now" | "Update"; action: "update" | "back-up" | "get-changes" };
}

const HERE = "Saved here";

interface Spec {
  key: StatusKey;
  right: string;
  /** Without the left clause. */
  whole?: boolean;
  announce?: string;
  headline?: string;
  title: string;
  detail?: string;
  icon: StatusLine["icon"];
  tone: StatusLine["tone"];
  click?: StatusLine["click"];
  clickAction?: StatusActionId;
  primary?: StatusAction;
  primaryQuiet?: boolean;
  secondary?: StatusAction;
  button?: StatusLine["button"];
}

function make(s: Spec): StatusLine {
  const text = s.whole ? s.right : `${HERE} · ${s.right}`;
  return {
    key: s.key,
    text,
    ...(s.whole ? {} : { left: HERE }),
    right: s.right,
    announce: s.announce ?? text,
    headline: s.headline ?? s.right,
    title: s.title,
    detail: s.detail ?? s.title,
    icon: s.icon,
    tone: s.tone,
    click: s.click ?? "popover",
    ...(s.clickAction ? { clickAction: s.clickAction } : {}),
    ...(s.primary ? { primary: s.primary } : {}),
    ...(s.primaryQuiet ? { primaryQuiet: true } : {}),
    ...(s.secondary ? { secondary: s.secondary } : {}),
    ...(s.button ? { button: s.button } : {}),
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "just now", "3 minutes ago", "2 hours ago": spelled out, never "mins" or "hrs". */
export function ago(ms: number, now: number): string {
  const min = Math.round((now - ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} ${min === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;
  try {
    return `on ${new Date(ms).toLocaleDateString()}`;
  } catch {
    return "a while ago";
  }
}

const SAFE = "Your work is safe on this computer.";

/** A pause the author can't clear by waiting: not a dropped connection or a busy server. */
function isTransient(message: string | undefined): boolean {
  return !message || /try again|timed? ?out|temporar|network|connection|busy|reach|unavailable/i.test(message);
}

/**
 * The one line in the status bar, by precedence:
 * save failed > unsaved > saving > versions failing > decide > (offline | sign-in |
 * can't find | paused) > (behind and/or ahead) > backing up > checking > backed up >
 * no online copy > no history. An action in flight (backing up) outranks the
 * "behind/ahead" it is about to fix, so the bar never keeps saying "New changes
 * online" while the author's Update is running.
 */
export function statusLine(i: StatusLineInput): StatusLine {
  const now = i.now ?? Date.now();
  const b = i.backup;
  // The host's machine-readable `reason` first; the message text is only a fallback for an older host.
  const missing =
    b?.state === "not-found" ||
    (b?.state === "error" && (b.reason === "not-found" || (b.reason === undefined && /can't find this online copy/i.test(b.message ?? ""))));
  const st: BackupSyncState | null = missing ? "not-found" : b && b.state !== "idle" ? b.state : null;
  const lastAt = Date.parse(b?.lastSyncAt ?? "");
  const lastKnown = Number.isNaN(lastAt) ? null : lastAt;

  // 3. A failed save outranks everything.
  if (i.savePhase === "error") {
    return make({
      key: "save-failed",
      right: "Couldn't save",
      whole: true,
      title: "Your latest changes couldn't be saved to this computer. Click to see why and try again.",
      detail: i.saveError ? `${i.saveError}` : "Your latest changes couldn't be saved to this computer.",
      icon: "circle-x",
      tone: "error",
      primary: { id: "save", label: "Try again" },
    });
  }
  // 2. Autosave off: the author's own Save is the fix.
  if (i.savePhase === "dirty" && !i.autoSave && !i.forceSaving) {
    const key = i.saveKey ?? "Ctrl+S";
    return make({
      key: "unsaved",
      right: `Unsaved changes · ${key} to save`,
      announce: "Unsaved changes",
      headline: "Unsaved changes",
      whole: true,
      title: `Your changes aren't saved to this computer yet. Click to save now (${key}).`,
      icon: "pen-line",
      tone: "warn",
      click: "action",
      clickAction: "save",
    });
  }
  // 1. Typing, autosave on.
  if (i.forceSaving || i.savePhase === "saving" || i.savePhase === "dirty") {
    return make({
      key: "saving",
      right: "Saving…",
      whole: true,
      title: "Saving your latest changes to this computer.",
      icon: "refresh-cw",
      tone: "pending",
      click: "none",
    });
  }
  // 17. A failing safety net is a different problem from the online copy.
  if (i.versionsProblem && (st === null || st === "local" || st === "synced" || st === "unsent")) {
    return make({
      key: "versions-failing",
      right: "Versions need attention",
      title: i.versionsProblem.message || "Earlier versions aren't being saved automatically. Click to see what you can do.",
      detail: i.versionsProblem.message || "Earlier versions aren't being saved automatically.",
      icon: "triangle-alert",
      tone: "warn",
      primary: { id: "save-version", label: "Save a version" },
    });
  }
  // 12. Two takes of a passage: stays until decided, over any backup news. The Problems list is the
  // truth once it has loaded; the host's count (per pass, it can stick) only fills in before that.
  const decide = i.problemsLoaded ? (i.decide ?? 0) : Math.max(i.decide ?? 0, b?.decide ?? 0);
  if (decide > 0) {
    return make({
      key: "decide",
      right: `${plural(decide, "passage", "passages")} to decide`,
      title: `${plural(decide, "passage was", "passages were")} changed in both places, and the book holds both. Click to choose which to keep.`,
      icon: "triangle-alert",
      tone: "warn",
      click: "action",
      clickAction: "open-problems",
    });
  }

  const inFlight = i.backingUp || !!i.gettingLatest || st === "syncing";
  const behind = !!b?.behind || !!i.updatesAvailable;
  const ahead = (b?.ahead ?? 0) > 0 || st === "unsent";
  const hasOnline = i.hasRemote || (st !== null && st !== "local");
  const manual = i.autoBackup === false && !!i.canSync;
  const sinceBackup = lastKnown === null ? "" : `Last backed up ${ago(lastKnown, now)}.`;

  if (hasOnline && !inFlight) {
    // 13-16. Something is stopping the online copy.
    if (st === "offline") {
      return make({
        key: "offline",
        right: "Offline — will back up when you're back",
        headline: "You're offline",
        title: `${SAFE} It will back up online when you're connected again. Click for options.`,
        detail: `${SAFE} It will back up online when you're connected again.`,
        icon: "cloud-off",
        tone: "plain",
        primary: { id: "try-again", label: "Try again" },
      });
    }
    if (st === "auth" || st === "connect" || (st === null && i.remoteNeeds === "sign-in")) {
      return make({
        key: "sign-in",
        right: "Sign in to back up",
        title: "The online copy needs you to sign in. Click to sign in.",
        detail: "The online copy needs you to sign in before it can back up. " + SAFE,
        icon: "key-round",
        tone: "warn",
        click: "action",
        clickAction: "open-backup",
        primary: { id: "open-backup", label: "Sign in" },
      });
    }
    if (st === "not-found") {
      const github = b?.host === "github";
      return make({
        key: "not-found",
        right: "Can't find the online copy",
        title: "Gutterpress can't find the online copy. It may have been renamed or deleted, or your account may no longer have access. Click for options.",
        detail: `Gutterpress can't find the online copy. It may have been renamed or deleted, or your account may no longer have access.${github ? " On GitHub that often means Gutterpress needs you to sign in again." : ""} ${SAFE}`,
        icon: "triangle-alert",
        tone: "warn",
        primary: { id: "open-backup", label: "Check the online link" },
        ...(github ? { secondary: { id: "open-backup", label: "Sign in again" } as const } : {}),
      });
    }
    if (st === "error") {
      const transient = isTransient(b?.message);
      return make({
        key: "paused",
        right: "Backup paused",
        title: b?.message || "Backing up is paused. Click to see why.",
        // A dropped connection says nothing the author can act on; anything else shows the host's own words.
        detail: transient ? `Backup stopped for now. ${SAFE}` : `${b?.message || "Backing up is paused."} ${SAFE}`,
        icon: "triangle-alert",
        tone: "warn",
        primary: transient ? { id: "try-again", label: "Try again" } : { id: "open-backup", label: "Open backup & history" },
        ...(transient ? { secondary: { id: "open-backup", label: "Open backup & history" } as const } : {}),
      });
    }
    // 9-11. Out of step with the online copy.
    if (behind && ahead) {
      return make({
        key: "behind-ahead",
        right: "Changes here and online",
        headline: "New changes online and on this computer",
        title: "Both this computer and the online copy have changes the other lacks. Click to update: get theirs, then back up yours.",
        detail: "Update brings in the online changes, then backs up yours. If the same passage changed in both places, you'll choose which to keep.",
        icon: "cloud",
        tone: "plain",
        primary: { id: "update", label: "Update" },
        button: { label: "Update", action: "update" },
      });
    }
    if (behind) {
      return make({
        key: "behind",
        right: "New changes online",
        title: "Someone, or another computer, changed this book online. Click to get the changes. Your own changes stay as they are.",
        detail: "Someone, or another computer, changed this book online. Getting the changes leaves your own changes as they are.",
        icon: "cloud-download",
        tone: "plain",
        primary: { id: "get-changes", label: "Get changes" },
        button: { label: "Get changes", action: "get-changes" },
      });
    }
    if (ahead) {
      const n = b?.ahead ?? 0;
      const right = n > 0 ? `${plural(n, "change", "changes")} not backed up` : "Not backed up yet";
      return make({
        key: "ahead",
        right,
        headline: right,
        title: `${n > 0 ? `${plural(n, "change is", "changes are")}` : "Your latest changes are"} saved on this computer but not in the online copy yet. Click to back up now.`,
        detail: "These changes are saved on this computer. Backing up sends them to the online copy.",
        icon: "cloud-upload",
        tone: "warn",
        primary: { id: "back-up", label: "Back up now" },
        button: { label: "Back up now", action: "back-up" },
      });
    }
  }
  // 8. Backing up (or getting changes).
  if (inFlight) {
    return make({
      key: "backing-up",
      right: i.gettingLatest && !i.backingUp && st !== "syncing" ? "Getting changes…" : "Backing up…",
      title: "Gutterpress is talking to the online copy. Your work is safe on this computer. Click for details.",
      detail: "Gutterpress is talking to the online copy. Your work is safe on this computer.",
      icon: "refresh-cw",
      tone: "pending",
      // With nothing automatic, the button stays (disabled, "Updating…") so it does not vanish under the author's click.
      ...(manual ? { button: { label: "Update", action: "update" } as const } : {}),
    });
  }
  if (hasOnline) {
    // An address Gutterpress can't back up over: claim nothing about what is or isn't online.
    if (st === "local" || (st === null && i.remoteNeeds === "own-tools")) {
      return make({
        key: "own-tools",
        right: "Online copy managed outside Gutterpress",
        headline: "Managed outside Gutterpress",
        title: "This book's online copy is managed outside Gutterpress, so Gutterpress doesn't back it up or check it. Click for details.",
        icon: "cloud",
        tone: "plain",
        primary: { id: "open-backup", label: "Open backup & history" },
      });
    }
    // 6. No real answer yet: say so, never a bare "Saved".
    if (st === null && !i.checked) {
      return make({
        key: "checking",
        right: "Checking online…",
        title: "Checking whether the online copy is up to date. Your work is safe on this computer. Click for details.",
        detail: `Checking whether the online copy is up to date. ${sinceBackup || "Nothing is known about it yet."} ${SAFE}`,
        icon: "refresh-cw",
        tone: "pending",
      });
    }
    // 7. Backed up.
    if (st === "synced") {
      const when = lastKnown === null ? "" : ` ${ago(lastKnown, now)}`;
      return make({
        key: "backed-up",
        right: `Backed up${when}`,
        headline: `Backed up${when}`,
        announce: `${HERE} · Backed up`,
        title: `Your latest work is in the online copy${lastKnown === null ? "" : ` (last backed up ${ago(lastKnown, now)})`}.${b?.local ? " Checking online in the background." : ""} Click for details.`,
        detail: "Your latest work is in the online copy.",
        icon: "circle-check",
        tone: "ok",
        primary: { id: "back-up", label: "Back up now" },
        primaryQuiet: true,
      });
    }
    // Checked, nothing new online, but nothing said what this computer has to send.
    return make({
      key: "nothing-new",
      right: "Nothing new online",
      title: "Nothing new in the online copy. Click for details.",
      detail: "There is nothing new in the online copy.",
      icon: "circle-check",
      tone: "ok",
      primary: { id: "back-up", label: "Back up now" },
      primaryQuiet: true,
    });
  }
  // 4. A plain folder.
  if (i.noHistory) {
    return make({
      key: "no-history",
      right: "No version history",
      title: "Nothing is keeping earlier versions of this book, so you can't go back. Click to turn on version history.",
      detail: "Nothing is keeping earlier versions of this book, so you can't go back. Turning it on keeps them on this computer. Nothing is uploaded.",
      icon: "history",
      tone: "plain",
      primary: { id: "turn-on-history", label: "Turn on version history" },
    });
  }
  // 5. Versions, but no online copy.
  if (st === "local" || i.classified === true) {
    return make({
      key: "no-online",
      right: "Not backed up online",
      title: "Your book is saved on this computer only. Click to back it up online.",
      detail: "Your book is saved on this computer only. If this computer is lost or broken, so is your book.",
      icon: "laptop",
      tone: "plain",
      primary: { id: "open-backup", label: "Back up this book online…" },
    });
  }
  // Not classified yet: claim nothing beyond what was written.
  return make({
    key: "unknown",
    right: HERE,
    whole: true,
    title: "Your changes are saved on this computer.",
    icon: "circle-check",
    tone: "ok",
    click: "none",
  });
}

/**
 * Why a save failed, in words an author can act on. The host's own text
 * ("EACCES: permission denied, open '/…/ch1.md'") names an error code and a path;
 * this keeps the cause and drops the rest. Your changes stay in the editor either way.
 */
export function saveFailureReason(raw: string): string {
  const stay = "Your changes are still in the editor.";
  if (/EACCES|EPERM|read-only|EROFS/i.test(raw)) return `This computer won't let Gutterpress write to the file. Check that it isn't read-only, then try again. ${stay}`;
  if (/ENOSPC|no space/i.test(raw)) return `The disk is full. Free up some space, then try again. ${stay}`;
  if (/EBUSY|ETXTBSY|locked/i.test(raw)) return `Another program is using the file. Close it, then try again. ${stay}`;
  return `Gutterpress couldn't write the file. Try again, and check the app log if it keeps happening. ${stay}`;
}

const files = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/**
 * "Saved · last version 10 mins ago", plus the work not in a version yet.
 * `stale`: a crashed version attempt may have left staged work, so
 * `changedFiles: 0` can't be trusted to mean "nothing to save".
 */
export function versionsLine(i: { lastVersionAt: number | null; changedFiles: number | null; stale?: boolean; now: number }): string {
  const last = i.lastVersionAt == null ? "no versions yet" : `last version ${agoFull(i.lastVersionAt, i.now)}`;
  const pending = i.changedFiles
    ? ` · ${files(i.changedFiles)} not in a version yet`
    : i.stale
      ? " · some recent work may not be in a version yet"
      : "";
  return `Saved · ${last}${pending}`;
}

export const NOTHING_NEW_NOTICE = "Nothing new to save — your last version already has everything.";
