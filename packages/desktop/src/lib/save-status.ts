/**
 * save-status.ts — the pure state → copy mapping behind the status bar's
 * "Where your work is kept" dialog.
 *
 * Writers see three different protections that all read like "saved":
 *   1. Saving         — edits written to a file on this computer,
 *   2. Versions       — restore points (local git commits) you can go back to,
 *   3. Online backup  — a copy of those versions on an online service.
 *
 * The old popover listed them as three bare facts ("Saved on this computer" /
 * "Last version saved 3 days ago"), which read as a contradiction. This module
 * turns the REAL state into a short explanation for each — what it is, what is
 * true right now, and what (if anything) the writer can do — and says so
 * plainly when the two clocks differ ("saved, but not in a version yet").
 *
 * Pure: no DOM, no host imports, no clock reads (callers pass `now`). The
 * dialog and StatusBar only render what this returns, so every state
 * combination is unit-testable. Never claims a fact it wasn't given: an unknown
 * value reads "Checking…" or is simply left out.
 *
 * Vocabulary: "version" (never commit/snapshot), "online backup" (never
 * remote/push/sync-jargon beyond the "Sync" word the toolbar already uses),
 * "restore point" only as the one analogy for what a version is.
 */
import { relativeTime } from "./format";
import type { SyncState } from "./platform/contract";

export type SaveStatusTone = "ok" | "info" | "warn" | "error" | "pending";

export type SaveStatusActionId =
  | "save"
  | "saveVersion"
  | "viewVersions"
  | "enableVersionHistory"
  | "connect"
  | "syncNow"
  | "openBookConnections";

export interface SaveStatusAction {
  id: SaveStatusActionId;
  label: string;
  disabled?: boolean;
  /** The main button of the section (styled as the primary). */
  primary?: boolean;
}

export interface SaveStatusSection {
  /** One line: what this thing IS, in plain words. Constant per section. */
  explain: string;
  /** One line: the current state, stated from real data. */
  status: string;
  /** Optional second line that qualifies the state. */
  detail?: string;
  /** Optional note about how it happens automatically. */
  note?: string;
  tone: SaveStatusTone;
  actions: SaveStatusAction[];
}

export interface SaveStatusCopy {
  saving: SaveStatusSection;
  versions: SaveStatusSection;
  online: SaveStatusSection;
}

export interface SaveStatusInput {
  /** Editor buffer save phase. */
  savePhase: "clean" | "dirty" | "saving" | "error";
  /** Settings → Saving "Save edits automatically". */
  autoSave: boolean;
  /** A manual Save is in progress. */
  forceSaving: boolean;
  versions: {
    /** The book keeps version history (a local git repo). False for a plain folder. */
    enabled: boolean;
    /** Settings → Saving "Keep previous versions" (automatic versions). */
    automatic: boolean;
    /** State of the lookup for the two facts below. */
    load: "loading" | "ready" | "error";
    /** Epoch ms of the newest version, or null when there is none. */
    lastVersionAt: number | null;
    /** Files changed since the newest version, or null when unknown. */
    changedFiles: number | null;
    /** "Save a version now" is in progress. */
    savingVersion: boolean;
  };
  online: {
    /** Live state from the sync status stream ("idle" until the first one). */
    state: SyncState;
    /** The book can sync (HTTPS remote + stored credential). */
    canSync: boolean;
    /** The repo has a remote at all (any protocol). */
    hasRemote: boolean;
    /** Settings → Saving "Keep this book backed up online". */
    automatic: boolean;
    /** ISO time of the last completed sync attempt this session, or null. */
    lastSyncAt: string | null;
    /** A manual Sync now is in progress. */
    syncing: boolean;
  };
  /** Epoch ms "now", injected so the mapping stays pure. */
  now: number;
}

// ── Constant explanations (one line each, no jargon) ──────────────────────────

export const SAVING_EXPLAIN = "What you type is written to a file on this computer.";
export const VERSIONS_EXPLAIN =
  "A version is a restore point: a copy of your whole book at one moment, so you can go back to it later.";
export const ONLINE_EXPLAIN =
  "A copy of your versions online, so you can open your book on another computer and it survives if this one is lost.";

const files = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/** "Your last version is from 3 days ago." / "…was made just now." */
function lastVersionLine(ago: string): string {
  if (ago === "just now") return "Your last version was made just now.";
  return `Your last version is from ${ago || "a while ago"}.`;
}

// ── Saving ────────────────────────────────────────────────────────────────────

export function savingSection(i: Pick<SaveStatusInput, "savePhase" | "autoSave" | "forceSaving">): SaveStatusSection {
  const base = { explain: SAVING_EXPLAIN };
  if (i.savePhase === "dirty" && !i.autoSave && !i.forceSaving) {
    return {
      ...base,
      status: "You have changes that aren't saved yet.",
      detail: "Autosave is off. Press Save to write them to this computer.",
      tone: "warn",
      actions: [{ id: "save", label: "Save now", primary: true }],
    };
  }
  if (i.forceSaving || i.savePhase === "saving" || i.savePhase === "dirty") {
    return { ...base, status: "Saving…", tone: "pending", actions: [] };
  }
  if (i.savePhase === "error") {
    return {
      ...base,
      status: "Couldn't save your last change.",
      detail: "It's still open here. Check that the file isn't locked or read-only, then try again.",
      tone: "error",
      actions: [{ id: "save", label: "Try saving again", primary: true }],
    };
  }
  return i.autoSave
    ? { ...base, status: "Saved on this computer automatically as you type.", tone: "ok", actions: [] }
    : {
        ...base,
        status: "All your changes are saved on this computer.",
        detail: "Autosave is off, so press Save after you make changes.",
        tone: "ok",
        actions: [],
      };
}

// ── Versions ──────────────────────────────────────────────────────────────────

export function versionsSection(
  i: Pick<SaveStatusInput, "versions" | "now">,
): SaveStatusSection {
  const v = i.versions;
  const base = { explain: VERSIONS_EXPLAIN };

  if (!v.enabled) {
    return {
      ...base,
      status: "Version history is off for this folder.",
      detail: "So there are no restore points yet. Your edits are still saved here.",
      tone: "info",
      actions: [{ id: "enableVersionHistory", label: "Turn on version history", primary: true }],
    };
  }

  const viewVersions: SaveStatusAction = { id: "viewVersions", label: "See previous versions" };
  const note = v.automatic
    ? "Gutterpress also makes one for you after you stop editing for 10 minutes, and when you close the book."
    : "Automatic versions are off (Settings → Saving), so make one yourself when you want a restore point.";

  if (v.load === "loading") {
    return { ...base, status: "Checking…", tone: "pending", note, actions: [] };
  }
  if (v.load === "error") {
    return {
      ...base,
      status: "Couldn't check your versions just now.",
      detail: "Your edits are still saved on this computer.",
      tone: "warn",
      note,
      actions: [{ id: "saveVersion", label: saveLabel(v.savingVersion), disabled: v.savingVersion }, viewVersions],
    };
  }

  const n = v.changedFiles;
  let status: string;
  let detail: string | undefined;
  let tone: SaveStatusTone;
  if (v.lastVersionAt == null) {
    status = "No versions yet.";
    tone = "info";
    if (n != null && n > 0) {
      detail = `${n === 1 ? "1 file is" : `${n} files are`} saved on this computer, but not in a version yet.`;
    }
  } else {
    status = lastVersionLine(relativeTime(v.lastVersionAt, i.now));
    if (n == null) {
      tone = "ok";
    } else if (n === 0) {
      detail = "Everything you've written is in it.";
      tone = "ok";
    } else {
      detail = `You've changed ${files(n)} since then. They're saved on this computer, but not in a version yet.`;
      tone = "info";
    }
  }

  return {
    ...base,
    status,
    ...(detail ? { detail } : {}),
    tone,
    note,
    actions: [
      {
        id: "saveVersion",
        label: saveLabel(v.savingVersion),
        disabled: v.savingVersion || n === 0,
        primary: n != null && n > 0,
      },
      viewVersions,
    ],
  };
}

function saveLabel(saving: boolean): string {
  return saving ? "Saving a version…" : "Save a version now";
}

// ── Online backup ─────────────────────────────────────────────────────────────

export function onlineSection(
  i: Pick<SaveStatusInput, "online" | "versions" | "now">,
): SaveStatusSection {
  const o = i.online;
  const base = { explain: ONLINE_EXPLAIN };
  const backUpNow = (label = "Back up now", primary = false): SaveStatusAction[] =>
    o.canSync ? [{ id: "syncNow", label, disabled: o.syncing, primary }] : [];

  if (!i.versions.enabled) {
    return {
      ...base,
      status: "Not set up.",
      detail: "It needs version history first — the backup is a copy of your versions.",
      tone: "info",
      actions: [],
    };
  }
  if (o.syncing || o.state === "syncing") {
    return { ...base, status: "Backing up now…", tone: "pending", actions: [] };
  }

  const checked =
    o.lastSyncAt && !Number.isNaN(Date.parse(o.lastSyncAt))
      ? `Last checked ${relativeTime(Date.parse(o.lastSyncAt), i.now)}.`
      : null;
  const autoOff = "Automatic backup is off (Settings → Saving).";

  switch (o.state) {
    case "synced":
      return {
        ...base,
        status: "On and working.",
        detail: [checked, o.automatic ? "New versions are sent every few minutes." : autoOff]
          .filter(Boolean)
          .join(" "),
        tone: "ok",
        actions: backUpNow(),
      };
    case "offline":
      return {
        ...base,
        status: "Offline.",
        detail: "Your work is safe on this computer. Backup picks up again when you're back online.",
        tone: "warn",
        actions: backUpNow("Try again"),
      };
    case "error":
      return {
        ...base,
        status: "The last backup didn't finish.",
        detail: "Your work is safe on this computer. Gutterpress will try again.",
        tone: "warn",
        actions: backUpNow("Try again"),
      };
    case "auth":
      return {
        ...base,
        status: "Sign-in needed.",
        detail: "Reconnect to keep your online copy up to date. Your work is safe here.",
        tone: "warn",
        actions: [{ id: "connect", label: "Reconnect", primary: true }],
      };
    case "connect":
      return {
        ...base,
        status: "Not connected yet.",
        detail: "This book has an online copy, but you haven't signed in to it on this computer.",
        tone: "info",
        actions: [{ id: "connect", label: "Connect", primary: true }],
      };
    case "local":
      return notSyncing(base.explain, o.hasRemote);
    case "idle":
    default:
      if (o.canSync) {
        return {
          ...base,
          status: o.automatic ? "Ready." : "Automatic backup is off.",
          detail: o.automatic
            ? "Gutterpress backs up in the background while this book is open."
            : "Turn it on in Settings → Saving, or back up now.",
          tone: o.automatic ? "ok" : "info",
          actions: backUpNow(),
        };
      }
      return notSyncing(base.explain, o.hasRemote);
  }
}

function notSyncing(explain: string, hasRemote: boolean): SaveStatusSection {
  if (hasRemote) {
    return {
      explain,
      status: "Not backing up automatically.",
      detail: "This book has an online address, but Gutterpress can't back up to it from here.",
      tone: "info",
      actions: [{ id: "openBookConnections", label: "See connection details" }],
    };
  }
  return {
    explain,
    status: "Not set up.",
    detail: "This book is only on this computer for now.",
    tone: "info",
    actions: [{ id: "openBookConnections", label: "See how to connect" }],
  };
}

export function saveStatusCopy(input: SaveStatusInput): SaveStatusCopy {
  return {
    saving: savingSection(input),
    versions: versionsSection(input),
    online: onlineSection(input),
  };
}
