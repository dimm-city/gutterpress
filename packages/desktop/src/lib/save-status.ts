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
import { relativeTime } from "./format";
import type { SyncState } from "./platform/contract";

export interface StatusLineInput {
  /** Editor buffer save phase. */
  savePhase: "clean" | "dirty" | "saving" | "error";
  /** Settings → Saving "Save changes automatically". */
  autoSave: boolean;
  /** A manual Save is in progress. */
  forceSaving: boolean;
  /** The host said automatic versions keep failing (and why). */
  versionsProblem: { message: string | null } | null;
  /** The online copy's last word: the host's stream or the last manual Sync (`null` until the first). */
  backup: { state: SyncState; message?: string } | null;
  /** The book has an online copy at all (any address), so an unknown state is not "only on this computer". */
  hasRemote: boolean;
  /** A manual Sync is in progress. */
  backingUp: boolean;
}

export interface StatusLine {
  text: string;
  /** The tooltip: the host's own explanation when it gave one, else the text. */
  title: string;
  /** The tone as a shape (check, cloud, warning, error), never colour alone. */
  icon: "circle-check" | "refresh-cw" | "pen-line" | "cloud-upload" | "triangle-alert" | "circle-x";
  /** `pending` is in flight; `warn` needs the author; `error` is a failed save. */
  tone: "ok" | "pending" | "warn" | "error";
}

const line = (text: string, icon: StatusLine["icon"], tone: StatusLine["tone"], detail?: string | null): StatusLine => ({
  text,
  title: detail || `${text} — click for details`,
  icon,
  tone,
});

/** The one line in the status bar. */
export function statusLine(i: StatusLineInput): StatusLine {
  const sync = i.backup?.state ?? "idle";
  if (i.savePhase === "error") return line("Couldn't save", "circle-x", "error");
  if (i.savePhase === "dirty" && !i.autoSave && !i.forceSaving) return line("Unsaved changes", "pen-line", "warn");
  if (i.forceSaving || i.savePhase === "saving" || i.savePhase === "dirty") return line("Saving…", "refresh-cw", "pending");
  // A failing safety net outranks the quiet online states, since it is a different problem.
  if (i.versionsProblem && (sync === "idle" || sync === "local" || sync === "synced" || sync === "unsent")) {
    return line("Versions need attention", "triangle-alert", "warn", i.versionsProblem.message);
  }
  if (i.backingUp || sync === "syncing") return line("Saved · Backing up…", "refresh-cw", "pending");
  switch (sync) {
    case "synced":
      return line("Saved · Backed up", "circle-check", "ok");
    case "unsent":
      return line("Saved · Not backed up yet", "cloud-upload", "ok");
    case "offline":
      return line("Saved · Offline — backs up when you're back", "cloud-upload", "ok");
    case "auth":
    case "connect":
      return line("Saved · Sign in to back up", "triangle-alert", "warn");
    case "error":
      return line("Saved · Backing up paused", "triangle-alert", "warn", i.backup?.message);
    case "local":
      return line("Saved on this computer", "circle-check", "ok");
    default:
      return line(i.hasRemote ? "Saved" : "Saved on this computer", "circle-check", "ok");
  }
}

const files = (n: number): string => `${n} file${n === 1 ? "" : "s"}`;

/**
 * "Saved · last version 10 mins ago", plus the work not in a version yet.
 * `stale`: a crashed version attempt may have left staged work, so
 * `changedFiles: 0` can't be trusted to mean "nothing to save".
 */
export function versionsLine(i: { lastVersionAt: number | null; changedFiles: number | null; stale?: boolean; now: number }): string {
  const last = i.lastVersionAt == null ? "no versions yet" : `last version ${relativeTime(i.lastVersionAt, i.now)}`;
  const pending = i.changedFiles
    ? ` · ${files(i.changedFiles)} not in a version yet`
    : i.stale
      ? " · some recent work may not be in a version yet"
      : "";
  return `Saved · ${last}${pending}`;
}

export const NOTHING_NEW_NOTICE = "Nothing new to save — your last version already has everything.";
