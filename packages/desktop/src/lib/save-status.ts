/**
 * save-status.ts — the pure state → copy mapping behind the status bar's
 * "Where your work is kept" dialog.
 *
 * Writers see three different protections that all read like "saved":
 *   1. Saving         — edits written to a file on this computer,
 *   2. Versions       — saved copies (local git commits) you can go back to,
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
 * Vocabulary: the noun is "version". The online side is always "online
 * backup". Never restore point / commit / snapshot / repository / branch /
 * push / pull / remote.
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
  | "openBookConnections"
  | "repair"
  | "repairNow"
  | "repairCancel";

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
  /** Calm one-off result of the last button press (e.g. "Nothing new to save").
   *  Not a problem, so it carries no tone; announced with the section. */
  notice?: string;
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
    /** "Save a version now" was just pressed and found nothing new to save. */
    nothingNew: boolean;
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
    /** "Repair online backup": offered (idle), awaiting confirmation (armed), or running. */
    repair: "idle" | "armed" | "running";
  };
  /** Epoch ms "now", injected so the mapping stays pure. */
  now: number;
}

// ── Constant explainers (one short sentence each) ─────────────────────────────

export const SAVING_EXPLAIN = "What you type is written to a file on this computer.";
export const VERSIONS_EXPLAIN =
  "A version is a saved copy of your book that you can go back to.";
export const NOTHING_NEW_NOTICE = "Nothing new to save — your last version already has everything.";
export const ONLINE_EXPLAIN =
  "A copy of your book kept online, so you can get it back if this computer is lost.";

const SETTING_VERSIONS = "Settings → Saving → Keep previous versions";
const SETTING_BACKUP = "Settings → Saving → Keep this book backed up online";

const COME_BACK = "Save a version to be able to come back to how your book is now.";
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

export function versionsSection(i: Pick<SaveStatusInput, "versions" | "online" | "now">): SaveStatusSection {
  const v = i.versions;
  const base = { explain: VERSIONS_EXPLAIN };

  if (v.enabled === null) return checking(base.explain);

  if (!v.enabled) {
    return {
      ...base,
      status: "Your book isn't keeping versions yet.",
      detail: "Your edits are saved, but you can't go back to an earlier version.",
      note: "This saves a first version of your book now.",
      tone: "action",
      actions: [{ id: "enableVersionHistory", label: "Start keeping versions", primary: true }],
    };
  }

  const viewVersions: SaveStatusAction = { id: "viewVersions", label: "See previous versions" };
  // A push-enabled backup pass always makes a version first (sync.ts).
  const backupMakesOne = i.online.automatic && i.online.canSync
    ? " Online backup also saves a version each time it uploads."
    : "";
  const note =
    (v.automatic
      ? `Gutterpress also makes one after you stop editing for ${VERSION_QUIET_MINUTES} minutes, and usually when you close the book.`
      : `Automatic versions are off (${SETTING_VERSIONS}). Make one yourself whenever you like.`) +
    backupMakesOne;
  const alert = v.problem
    ? "Automatic versions aren't working right now. Try Save a version now. If that fails, close any other program that might be using your book folder."
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
  let status: string;
  let detail: string | undefined;
  let tone: SaveStatusTone;
  if (v.lastVersionAt == null) {
    status = "No versions yet.";
    tone = "neutral";
    if (n != null && n > 0) {
      detail = `${n === 1 ? "1 file is" : `${n} files are`} saved on this computer, but not in a version yet. ${COME_BACK}`;
      tone = "action";
    }
  } else {
    status = lastVersionLine(relativeTime(v.lastVersionAt, i.now));
    if (n == null) {
      tone = "ok";
    } else if (n > 0) {
      detail = `You've changed ${files(n)} since then. They're saved on this computer, but not in a version yet. ${COME_BACK}`;
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
    // Always offered: pressing it on a clean book is a calm no-op (the notice).
    ...(v.nothingNew && !(n != null && n > 0) ? { notice: NOTHING_NEW_NOTICE } : {}),
    actions: [saveBtn({ primary: (n != null && n > 0) || v.stale }), viewVersions],
  };
}

// ── Online backup ─────────────────────────────────────────────────────────────

/** What "Repair online backup" does, in the order it does it. Shown before the
 *  button so a writer can decide with no surprises. */
export const REPAIR_EXPLAIN =
  "Repair downloads a fresh copy of your book's online history and puts it under the files on this computer. " +
  "Your files here stay exactly as they are and win over the online copy; anything only the online copy has is brought back. " +
  "The old history is kept aside in the app's data folder, not deleted. Then a version is saved and backed up.";
const REPAIR_ACTION: SaveStatusAction = { id: "repair", label: "Repair online backup…" };

export function onlineSection(
  i: Pick<SaveStatusInput, "online" | "versions" | "now">,
): SaveStatusSection {
  const o = i.online;
  const base = { explain: ONLINE_EXPLAIN };
  // Offered in every state where a manual backup can work (a usable remote and
  // a stored sign-in); primary only when it is the suggested fix.
  const busy = o.syncing || o.state === "syncing";
  const backUpNow = (primary = false): SaveStatusAction[] =>
    o.canSync
      ? [{ id: "syncNow", label: busy ? "Backing up…" : "Back up now", disabled: busy, primary: primary && !busy }]
      : [];

  if (i.versions.enabled === null) return checking(base.explain);
  if (!i.versions.enabled) {
    return {
      ...base,
      status: "Not backed up online.",
      detail: "Turn on versions first to use online backup.",
      tone: "neutral",
      actions: [],
    };
  }
  if (o.repair === "running") {
    return { ...base, status: "Repairing online backup…", detail: "This can take a minute. Your files on this computer stay as they are.", tone: "pending", actions: [] };
  }
  if (o.repair === "armed") {
    return {
      ...base,
      status: "Repair online backup?",
      detail: REPAIR_EXPLAIN,
      tone: "action",
      actions: [
        { id: "repairNow", label: "Repair now", primary: true },
        { id: "repairCancel", label: "Cancel" },
      ],
    };
  }
  if (o.syncing || o.state === "syncing") {
    return { ...base, status: "Backing up now…", tone: "pending", actions: backUpNow() };
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
          : "Your work is safe on this computer. Use Back up now when you're back online.",
        tone: "warn",
        actions: backUpNow(!o.automatic),
      };
    case "error":
      return {
        ...base,
        status: "The last online backup didn't finish.",
        detail: o.automatic
          ? "Your work is safe on this computer. Gutterpress will try again. If it keeps failing, use Repair online backup."
          : "Your work is safe on this computer. Use Back up now when you're ready, or Repair online backup if it keeps failing.",
        tone: "warn",
        actions: [...backUpNow(!o.automatic), ...(o.canSync ? [REPAIR_ACTION] : [])],
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
        detail: "This book is linked to an online account, but you're not signed in on this computer.",
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
              status: "Online backup is on. Your book will be copied online automatically.",
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
      detail: "This book is linked to an online location Gutterpress can't back up to automatically.",
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
