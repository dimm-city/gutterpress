import type { SnapshotEntry } from "#lib/api.ts";

/**
 * Writer-facing view helpers for the "Version history" timeline
 * (VersionHistoryView). `SnapshotEntry` has no `kind` field, so the stored
 * `message` string is the ONLY discriminator the renderer has. The machine
 * messages below are produced by the CLI lib and the vcs routes; they are
 * matched as LITERAL strings — never imported — both because the SPA never
 * value-imports the lib (§8) and because superseded spellings live
 * in existing project history forever, so every spelling ever shipped stays
 * listed. Anything unrecognized is a version the author saved by hand. Pure,
 * no runes — mirrors outline.ts / toc-tree.ts and is unit-tested directly.
 */
export type VersionKind = "automatic" | "combined" | "created" | "manual";

/** Automatic machine messages (collapsible into one row per run). */
const AUTOMATIC_MESSAGES = new Set<string>([
  // Current spellings (docs/ux-design-contract.md, Vocabulary).
  "Automatic version",
  "Automatic version before backing up",
  "Automatic version before restoring",
  "Saved before switching revision",
  "Repaired the online copy",
  "Saved the edit you made while backing up",
  // converge-merge CONVERGE_PREPARE_MESSAGE (pre-combine equalization)
  "Getting your changes ready to combine with the online copy's changes",
  // Superseded spellings: existing history keeps them forever.
  "Automatic snapshot",
  "Automatic backup of your work",
  "Snapshot before syncing",
  "Saved the edit you made while syncing",
  "Automatic backup before restoring an earlier version",
  "Saved before switching copy",
  "Repaired online backup",
  "Getting your changes ready to combine with the online version",
]);

/** The delete route saves a version first: "Before deleting chapter-02.md". */
const BEFORE_DELETING = "Before deleting ";

/** What a sync's merge recorded (converge-merge's commit messages). */
const COMBINED_MESSAGES = new Set<string>([
  // CONVERGE_MERGE_MESSAGE
  "Combined your changes with the online copy's",
  // CONVERGE_RESTORE_MESSAGE (kept-both restore)
  "Kept both takes of the files that can't be combined",
  // Superseded spellings: existing history keeps them forever.
  "Combined your changes with the online version",
  "Kept both versions of the files that can't be combined",
]);

/** History-start commits (enable-version-history route, project-scaffold). */
const CREATED_MESSAGES = new Set<string>([
  "First version",
  "Initial snapshot",
  "Created project",
  "Set up as a gutterpress book",
]);

/** The save-a-version route's default notes: a manual save, but never an author's own words. */
const DEFAULT_NOTES = new Set<string>(["Saved a version", "Saved snapshot"]);

export function versionKind(message: string): VersionKind {
  if (CREATED_MESSAGES.has(message)) return "created";
  if (AUTOMATIC_MESSAGES.has(message) || message.startsWith(BEFORE_DELETING)) return "automatic";
  if (COMBINED_MESSAGES.has(message)) return "combined";
  return "manual";
}

/** The plain-language row title shown to writers. */
export function versionLabel(message: string): string {
  switch (versionKind(message)) {
    case "automatic":
      return "Automatic version";
    case "combined":
      return "Combined with the online copy";
    case "created":
      return "First version";
    case "manual":
      return "Version saved by you";
  }
}

/**
 * The author's own note for a manual save (shown as a second line). Machine
 * entries carry only their recorded message, which the label already conveys,
 * so they get no description — and neither do the save-a-version route's
 * default notes (a manual save, but not an author note).
 */
export function versionDescription(message: string): string | null {
  if (versionKind(message) !== "manual") return null;
  if (DEFAULT_NOTES.has(message)) return null;
  return message;
}

export interface VersionDay<T extends SnapshotEntry = SnapshotEntry> {
  /** Stable local-day key (yyyy-m-d) for `{#each}` keying. */
  key: string;
  /** Human day heading: "Today", "Yesterday", or a written date. */
  label: string;
  entries: T[];
}

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(ms: number, now: number): string {
  const key = dayKey(ms);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(now - 86_400_000)) return "Yesterday";
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Group already time-ordered (newest-first) versions into consecutive day
 * buckets, preserving order. `now` is injected so the "Today"/"Yesterday"
 * labelling is pure and testable.
 */
export function groupVersionsByDay<T extends SnapshotEntry>(entries: T[], now: number): VersionDay<T>[] {
  const days: VersionDay<T>[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.timestamp);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(entry.timestamp, now), entries: [entry] });
  }
  return days;
}

// ── Collapsed automatic runs ─────────────────────────────────────────────────

/** One renderable timeline row: a single version, or a run of automatic versions. */
export type TimelineRow<T extends SnapshotEntry = SnapshotEntry> =
  | { kind: "entry"; key: string; entry: T }
  | { kind: "auto-run"; key: string; entries: T[] };

/**
 * Fold 2+ consecutive automatic versions into one expandable row, so a
 * busy writing day reads as one line instead of hundreds. A pure
 * display transform over one day's (newest-first) entries — restore still
 * targets the individual entries inside the run. A run is keyed by its
 * OLDEST entry so its identity survives newer versions prepending.
 */
export function collapseAutomaticRuns<T extends SnapshotEntry>(entries: T[]): TimelineRow<T>[] {
  const rows: TimelineRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= 2) {
      rows.push({ kind: "auto-run", key: `auto-${run[run.length - 1]!.id}`, entries: run });
    } else if (run.length === 1) {
      rows.push({ kind: "entry", key: run[0]!.id, entry: run[0]! });
    }
    run = [];
  };
  for (const entry of entries) {
    if (versionKind(entry.message) === "automatic") {
      run.push(entry);
    } else {
      flush();
      rows.push({ kind: "entry", key: entry.id, entry });
    }
  }
  flush();
  return rows;
}

/** "Versions made automatically · 9:02 AM–1:14 PM · 84 times" (entries newest-first). */
export function autoRunSummary(entries: SnapshotEntry[]): string {
  const at = (ms: number): string => {
    try {
      return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };
  const newest = at(entries[0]!.timestamp);
  const oldest = at(entries[entries.length - 1]!.timestamp);
  const span = oldest === newest ? newest : `${oldest}–${newest}`;
  return `Versions made automatically · ${span} · ${entries.length} times`;
}

/**
 * A version row's title: the author's own note when there is one ("Sent to
 * printer"), else the plain label ("Automatic version"); "Version saved by you— Edit 150" is gone.
 */
export function versionTitle(message: string): string {
  return versionDescription(message) ?? versionLabel(message);
}

/** The line under a noted version's title; null when the title already is the label. */
export function versionSubtitle(_message: string): string | null {
  // A noted version's note is its title; "Version saved by you" under it says nothing more.
  return null;
}

/** "Today, 11:40 AM" / "Yesterday, 4:05 PM" / "Nov 5, 10:42 AM". */
export function whenShort(ms: number, now: number): string {
  const d = new Date(ms);
  const day = (t: number) => `${new Date(t).getFullYear()}-${new Date(t).getMonth()}-${new Date(t).getDate()}`;
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (day(ms) === day(now)) return `Today, ${time}`;
  if (day(ms) === day(now - 86_400_000)) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

// ── Book setup → Online: what is waiting, and the Saved versions summary ─────

/** "4:46 PM" today, "4:37 PM–4:52 PM" for a run today, "Yesterday, 4:46 PM", "Nov 5, 4:37 PM–4:52 PM". */
export function whenRange(from: number, to: number, now: number): string {
  const end = whenShort(to, now).replace(/^Today, /, "");
  if (new Date(from).toDateString() !== new Date(to).toDateString()) return end;
  const clock = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return clock(from) === clock(to) ? end : end.replace(clock(to), `${clock(from)}–${clock(to)}`);
}

/** What one version changed, as the Waiting rows need it (VersionChanges, or an online version's own list). */
export interface ChangedFiles {
  files: { path: string; hint?: string }[];
  more: number;
}

/** One row of the Waiting card: a version, or a run of automatic versions by one author. */
export interface WaitingRow {
  /** The newest version in the row: the row opens Version history on it. */
  id: string;
  /** How many versions the row stands for. */
  count: number;
  /** "New opening paragraph", "Automatic version", "3 automatic versions". */
  title: string;
  /** The author named it (shown with a star). */
  named: boolean;
  author?: string;
  from: number;
  to: number;
  /** File names as written ("chapters/ch19.md"), a few; `hint` when the row is one version of one file. */
  files: string[];
  hint?: string;
  /** Changed files beyond those named. */
  more: number;
  /** Some of the row's versions were not looked at, so there may be more files. */
  partial: boolean;
}

const ROW_FILES = 3;

/**
 * Fold newest-first versions into Waiting rows: consecutive automatic versions by
 * the same author become one row ("3 automatic versions", their time range and
 * the files they touched); anything else is a row of its own. `changes` gives
 * what a version changed, when it was looked at.
 */
export function waitingRows<T extends SnapshotEntry>(entries: T[], changes: (e: T) => ChangedFiles | undefined): WaitingRow[] {
  const auto = (e: T) => versionKind(e.message) === "automatic";
  const groups: T[][] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && auto(e) && auto(last[0]!) && last[0]!.author === e.author) last.push(e);
    else groups.push([e]);
  }
  return groups.map((g) => {
    const newest = g[0]!;
    const hints = new Map<string, string | undefined>();
    let more = 0;
    let partial = false;
    for (const e of g) {
      const c = changes(e);
      if (!c) partial = true;
      else {
        more += c.more;
        for (const f of c.files) if (!hints.has(f.path)) hints.set(f.path, f.hint);
      }
    }
    const paths = [...hints.keys()];
    const hint = g.length === 1 && paths.length === 1 && more === 0 ? hints.get(paths[0]!) : undefined;
    return {
      id: newest.id,
      count: g.length,
      title: auto(newest) ? (g.length === 1 ? "Automatic version" : `${g.length} automatic versions`) : versionTitle(newest.message),
      named: versionDescription(newest.message) !== null,
      ...(newest.author ? { author: newest.author } : {}),
      from: g[g.length - 1]!.timestamp,
      to: newest.timestamp,
      files: paths.slice(0, ROW_FILES),
      ...(hint ? { hint } : {}),
      more: more + Math.max(0, paths.length - ROW_FILES),
      partial,
    };
  });
}

/** The Saved versions card: today's automatic versions in one line, then the newest named ones. */
export interface SavedSummary {
  /** Today's automatic versions; `atLeast`: the page ends before today does, so there are more. */
  today: { count: number; atLeast: boolean; from: number; to: number } | null;
  /** The newest versions the author named, newest first. */
  named: SnapshotEntry[];
}

export function savedSummary(page: { entries: SnapshotEntry[]; hasMore: boolean }, now: number, namedMax = 3): SavedSummary {
  const today = new Date(now).toDateString();
  const isToday = (e: SnapshotEntry) => new Date(e.timestamp).toDateString() === today;
  const autos = page.entries.filter((e) => isToday(e) && versionKind(e.message) === "automatic");
  const oldest = page.entries[page.entries.length - 1];
  return {
    today: autos.length
      ? { count: autos.length, atLeast: page.hasMore && !!oldest && isToday(oldest), from: autos[autos.length - 1]!.timestamp, to: autos[0]!.timestamp }
      : null,
    named: page.entries.filter((e) => versionDescription(e.message) !== null).slice(0, namedMax),
  };
}
