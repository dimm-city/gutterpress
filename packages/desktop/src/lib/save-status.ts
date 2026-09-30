/**
 * save-status.ts — the pure state → copy mapping behind the status bar's
 * "Where your work is kept" dialog.
 *
 * Writers see three different protections that all read like "saved":
 *   1. Saving         — edits written to a file on this computer,
 *   2. Versions       — restore points (local git commits) you can go back to,
 *   3. Online backup  — a copy of those versions on an online service.
 *
 * This module turns the REAL state into a short explanation for each — the
 * current state first, then what the thing is, then what (if anything) the
 * writer can do — and says so plainly when the two clocks differ ("saved, but
 * not in a version yet").
 *
 * Pure: no DOM, no host imports, no clock reads (callers pass `now`). The
 * dialog and StatusBar only render what this returns, so every state
 * combination is unit-testable. Never claims a fact it wasn't given: an unknown
 * value reads "Checking…" or is simply left out.
 *
 * Vocabulary: the noun is "version" ("restore point" appears only in the
 * one-line explainer). The online side is always "online backup". Never
 * commit / snapshot / repository / branch / push / pull / remote.
 */
import { relativeTime } from "./format";
import type { SyncState } from "./platform/contract";

/**
 * Cadence the copy quotes. The lib owns the real values
 * (`AUTO_SNAPSHOT_DEFAULT_MINUTES`, `AUTO_SYNC_PUSH_INTERVAL_MINUTES` in
 * host-policy.ts); the renderer can't value-import the lib (CLAUDE.md §8), so
 * tests/platform/save-status.test.ts asserts these equal the lib's constants.
 */
export const VERSION_QUIET_MINUTES = 10;
export const BACKUP_UPLOAD_MINUTES = 15;

export type SaveStatusTone = "ok" | "neutral" | "action" | "warn" | "error" | "pending";

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
  /** One line: the current state, from real data. Shown first. */
  status: string;
  /** Optional second line that qualifies the state. */
  detail?: string;
  /** A problem worth its own warning line (e.g. automatic versions failing). */
  alert?: string;
  /** One short sentence: what this thing IS. Constant per section. */
  explain: string;
  /** Optional extra note about how it happens automatically. */
  note?: string;
  tone: SaveStatusTone;
  actions: SaveStatusAction[];
}

export interface SaveStatusCopy {
  /** The "is my work safe?" line at the top. */
  summary: { text: string; tone: SaveStatusTone };
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
    /** The book keeps version history (a local git repo). False for a plain
     *  folder; `null` while the project's classification hasn't loaded yet. */
    enabled: boolean | null;
    /** Settings → Saving "Keep previous versions" (automatic versions). */
    automatic: boolean;
    /** State of the lookup for the facts below. */
    load: "loading" | "ready" | "error";
    /** Epoch ms of the newest version, or null when there is none. */
    lastVersionAt: number | null;
    /** Files of this book changed since the newest version, or null when unknown. */
    changedFiles: number | null;
    /** A crashed version attempt may have left staged work: `changedFiles: 0`
     *  can't be trusted to mean "nothing to save". */
    stale: boolean;
    /** "Save a version now" is in progress. */
    savingVersion: boolean;
    /** The host reported that automatic versions keep failing. */
    problem: boolean;
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
    /** ISO time of the last completed backup check this session, or null. */
    lastSyncAt: string | null;
    /** A manual "Back up now" is in progress. */
    syncing: boolean;
  };
  /** Epoch ms "now", injected so the mapping stays pure. */
  now: number;
}

// ── Constant explainers (one short sentence each) ─────────────────────────────

export const SAVING_EXPLAIN = "What you type is written to a file on this computer.";
export const VERSIONS_EXPLAIN =
  "A version is a restore point: a copy of your book you can go back to later.";
export const ONLINE_EXPLAIN =
  "A copy of your book kept online, so you can get it back if this computer is lost.";

const SETTING_VERSIONS = "Settings → Saving → Keep previous versions";
const SETTING_BACKUP = "Settings → Saving → Keep this book backed up online";

const files = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/** "Your last version is from 3 days ago." / "…was made just now." */
function lastVersionLine(ago: string): string {
  if (ago === "just now") return "Your last version was made just now.";
  return `Your last version is from ${ago || "a while ago"}.`;
}

const checking = (explain: string): SaveStatusSection => ({
  status: "Checking…",
  explain,
  tone: "pending",
  actions: [],
});

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
      detail: "It's still open here. Check that the file isn't open in another program or set to read-only.",
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

export function versionsSection(i: Pick<SaveStatusInput, "versions" | "now">): SaveStatusSection {
  const v = i.versions;
  const base = { explain: VERSIONS_EXPLAIN };

  if (v.enabled === null) return checking(base.explain);

  if (!v.enabled) {
    return {
      ...base,
      status: "Your book isn't keeping versions yet.",
      detail: "Your edits are saved on this computer, but you can't go back to an earlier copy.",
      note: "This saves a first version of your book now.",
      tone: "action",
      actions: [{ id: "enableVersionHistory", label: "Start keeping versions", primary: true }],
    };
  }

  const viewVersions: SaveStatusAction = { id: "viewVersions", label: "See previous versions" };
  const note = v.automatic
    ? `Gutterpress also makes one after you stop editing for ${VERSION_QUIET_MINUTES} minutes, and usually when you close the book.`
    : `Automatic versions are off (${SETTING_VERSIONS}). Make one yourself whenever you like.`;
  const alert = v.problem
    ? "Automatic versions aren't completing. Try Save a version now; if it keeps failing, make sure no other program has the book folder open."
    : undefined;
  const withAlert = alert ? { alert } : {};

  if (v.load === "loading") {
    return { ...base, status: "Checking…", tone: "pending", note, ...withAlert, actions: [] };
  }
  const saveBtn = (extra: Partial<SaveStatusAction> = {}): SaveStatusAction => ({
    id: "saveVersion",
    label: v.savingVersion ? "Saving a version…" : "Save a version now",
    disabled: v.savingVersion,
    ...extra,
  });
  if (v.load === "error") {
    return {
      ...base,
      status: "Couldn't check your versions just now.",
      detail: "Your edits are still saved on this computer.",
      tone: "warn",
      note,
      ...withAlert,
      actions: [saveBtn(), viewVersions],
    };
  }

  const n = v.changedFiles;
  const nothingToSave = n === 0 && !v.stale;
  let status: string;
  let detail: string | undefined;
  let tone: SaveStatusTone;
  if (v.lastVersionAt == null) {
    status = "No versions yet.";
    tone = "neutral";
    if (n != null && n > 0) {
      detail = `${n === 1 ? "1 file is" : `${n} files are`} saved on this computer, but not in a version yet.`;
      tone = "action";
    }
  } else {
    status = lastVersionLine(relativeTime(v.lastVersionAt, i.now));
    if (n == null) {
      tone = "ok";
    } else if (n > 0) {
      detail = `You've changed ${files(n)} since then. They're saved on this computer, but not in a version yet.`;
      tone = "action";
    } else if (v.stale) {
      detail = "Some recent work may not be in it yet.";
      tone = "action";
    } else {
      detail = "Everything you've written is in that version.";
      tone = "ok";
    }
  }
  if (v.lastVersionAt == null && n === 0 && v.stale) {
    detail = "Some recent work may not be in a version yet.";
    tone = "action";
  }

  return {
    ...base,
    status,
    ...(detail ? { detail } : {}),
    tone,
    note,
    ...withAlert,
    actions: [
      ...(nothingToSave ? [] : [saveBtn({ primary: (n != null && n > 0) || v.stale })]),
      viewVersions,
    ],
  };
}

// ── Online backup ─────────────────────────────────────────────────────────────

export function onlineSection(
  i: Pick<SaveStatusInput, "online" | "versions" | "now">,
): SaveStatusSection {
  const o = i.online;
  const base = { explain: ONLINE_EXPLAIN };
  const backUpNow = (label = "Back up now", primary = false): SaveStatusAction[] =>
    o.canSync ? [{ id: "syncNow", label, disabled: o.syncing, primary }] : [];

  if (i.versions.enabled === null) return checking(base.explain);
  if (!i.versions.enabled) {
    return {
      ...base,
      status: "Not backed up online.",
      detail: "Online backup needs versions first — start keeping versions above.",
      tone: "neutral",
      actions: [],
    };
  }
  if (o.syncing || o.state === "syncing") {
    return { ...base, status: "Backing up now…", tone: "pending", actions: [] };
  }

  const checked =
    o.lastSyncAt && !Number.isNaN(Date.parse(o.lastSyncAt))
      ? `Checked ${relativeTime(Date.parse(o.lastSyncAt), i.now)}.`
      : null;

  switch (o.state) {
    case "synced":
      return {
        ...base,
        status: "Your book is backed up online.",
        detail: [
          checked,
          o.automatic
            ? `New versions are uploaded about every ${BACKUP_UPLOAD_MINUTES} minutes, and usually when you close the book.`
            : `Automatic online backup is off (${SETTING_BACKUP}), so use Back up now.`,
        ]
          .filter(Boolean)
          .join(" "),
        note: "You can open it on another computer too.",
        tone: "ok",
        actions: backUpNow(),
      };
    case "offline":
      return {
        ...base,
        status: "You're offline.",
        detail: o.automatic
          ? "Your work is safe on this computer. Online backup will try again on its own."
          : "Your work is safe on this computer. Use Try again when you're back online.",
        tone: "warn",
        actions: backUpNow("Try again"),
      };
    case "error":
      return {
        ...base,
        status: "The last online backup didn't finish.",
        detail: o.automatic
          ? "Your work is safe on this computer. Gutterpress will try again."
          : "Your work is safe on this computer. Use Try again when you're ready.",
        tone: "warn",
        actions: backUpNow("Try again"),
      };
    case "auth":
      return {
        ...base,
        status: "Please sign in again.",
        detail: "Your online backup paused because the sign-in ran out. Your work is safe on this computer.",
        tone: "warn",
        actions: [{ id: "connect", label: "Sign in again", primary: true }],
      };
    case "connect":
      return {
        ...base,
        status: "Not signed in to online backup.",
        detail: "This book has an online address, but you haven't signed in to it on this computer.",
        tone: "action",
        actions: [{ id: "connect", label: "Sign in to online backup", primary: true }],
      };
    case "local":
      return notBackedUp(base.explain, o.hasRemote);
    case "idle":
    default:
      if (o.canSync) {
        return o.automatic
          ? {
              ...base,
              status: "Ready — your book will be backed up automatically.",
              tone: "ok",
              actions: backUpNow(),
            }
          : {
              ...base,
              status: "Automatic online backup is off.",
              detail: `Turn it on in ${SETTING_BACKUP}, or back up now.`,
              tone: "neutral",
              actions: backUpNow(),
            };
      }
      return notBackedUp(base.explain, o.hasRemote);
  }
}

function notBackedUp(explain: string, hasRemote: boolean): SaveStatusSection {
  if (hasRemote) {
    return {
      explain,
      status: "Not backed up online.",
      detail: "This book has an online address, but Gutterpress can't back up to it from here.",
      tone: "neutral",
      actions: [{ id: "openBookConnections", label: "Online backup details…" }],
    };
  }
  return {
    explain,
    status: "Not backed up online.",
    detail: "This book is only on this computer for now.",
    tone: "neutral",
    actions: [{ id: "openBookConnections", label: "Set up online backup…" }],
  };
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function summaryLine(
  i: Pick<SaveStatusInput, "savePhase" | "autoSave" | "forceSaving">,
): SaveStatusCopy["summary"] {
  const s = savingSection(i);
  switch (s.tone) {
    case "error":
      return { text: "Your last change couldn't be saved.", tone: "error" };
    case "warn":
      return { text: "You have changes that aren't saved yet.", tone: "warn" };
    case "pending":
      return { text: "Saving your writing…", tone: "pending" };
    default:
      return { text: "Your writing is safe on this computer.", tone: "ok" };
  }
}

export function saveStatusCopy(input: SaveStatusInput): SaveStatusCopy {
  return {
    summary: summaryLine(input),
    saving: savingSection(input),
    versions: versionsSection(input),
    online: onlineSection(input),
  };
}
