import type { SnapshotEntry, VersionChanges, VersionEntry, VersionFileChange } from "#lib/api.ts";

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

/** Automatic machine messages (folded into editing sessions). */
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

// ── Editing sessions ────────────────────────────────────────────────────────

/** A pause this long between automatic versions ends an editing session. */
export const SESSION_GAP_MS = 60 * 60_000;

/** One renderable timeline row: a single version, or an editing session of automatic versions. */
export type TimelineRow<T extends SnapshotEntry = SnapshotEntry> =
  | { kind: "version"; key: string; entry: T }
  | { kind: "session"; key: string; entries: T[] };

/**
 * Fold 2+ consecutive automatic versions of one (newest-first) day into an
 * editing session, so a busy writing day reads as a few lines and the
 * versions the author named stand out between them. A pause of
 * {@link SESSION_GAP_MS} starts a new session. Restore still targets the
 * individual versions inside. A session is keyed by its OLDEST version so
 * its identity (and whether it is open) survives newer versions arriving.
 */
export function editingSessions<T extends SnapshotEntry>(entries: T[]): TimelineRow<T>[] {
  const rows: TimelineRow<T>[] = [];
  let run: T[] = [];
  const flush = () => {
    if (run.length >= 2) rows.push({ kind: "session", key: `session-${run[run.length - 1]!.id}`, entries: run });
    else if (run.length === 1) rows.push({ kind: "version", key: run[0]!.id, entry: run[0]! });
    run = [];
  };
  for (const entry of entries) {
    if (versionKind(entry.message) !== "automatic") {
      flush();
      rows.push({ kind: "version", key: entry.id, entry });
      continue;
    }
    const prev = run[run.length - 1];
    if (prev && prev.timestamp - entry.timestamp >= SESSION_GAP_MS) flush();
    run.push(entry);
  }
  flush();
  return rows;
}

/** "Editing · 14 automatic saves". */
export function sessionTitle(count: number): string {
  return `Editing · ${count} automatic saves`;
}

/** A clock time; without its AM/PM when `period` is false. */
function clock(ms: number, period: boolean): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).formatToParts(new Date(ms));
    return (period ? parts : parts.filter((p) => p.type !== "dayPeriod"))
      .map((p) => p.value)
      .join("")
      .trim();
  } catch {
    return "";
  }
}

/** A session's span, oldest to newest (entries newest-first): "4:49–4:52 PM", "11:58 AM–4:52 PM", or one time. */
export function timeSpan(entries: SnapshotEntry[]): string {
  const newest = entries[0]!.timestamp;
  const oldest = entries[entries.length - 1]!.timestamp;
  const end = clock(newest, true);
  const start = clock(oldest, true);
  if (start === end) return end;
  // The same AM/PM on both ends is said once, at the end.
  const period = (ms: number, full: string) => full.slice(clock(ms, false).length);
  return `${period(oldest, start) === period(newest, end) ? clock(oldest, false) : start}–${end}`;
}

/** A file's name without its folders: "themes/book.css" → "book.css". */
export function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A size hint without the "changed" most hints end with: "3 paragraphs changed" → "3 paragraphs". */
export function shortHint(hint: string): string {
  return hint.endsWith(" changed") ? hint.slice(0, -" changed".length) : hint;
}

/**
 * What a version row says it changed: "ch14.md · 1 paragraph" for one file,
 * "ch03.md, ch04.md, ch11.md" for a few, "+N" past `shown`, "No changes".
 */
export function changedSummary(changes: VersionChanges, shown = 4): string {
  const { files, more } = changes;
  if (files.length === 0) return "No changes";
  if (files.length === 1 && !more) return `${fileName(files[0]!.path)} · ${shortHint(files[0]!.hint)}`;
  return namesWithMore(
    files.map((f) => fileName(f.path)),
    shown,
    more,
  );
}

/** The files a session touched, each named once, from the versions whose changes have loaded. */
export function sessionFiles(loaded: (VersionChanges | undefined)[], shown = 4): string {
  const names = new Set<string>();
  let more = 0;
  for (const changes of loaded) {
    if (!changes) continue;
    for (const f of changes.files) names.add(fileName(f.path));
    more = Math.max(more, changes.more);
  }
  return namesWithMore([...names], shown, more);
}

function namesWithMore(names: string[], shown: number, more: number): string {
  const extra = Math.max(0, names.length - shown) + more;
  return names.slice(0, shown).join(", ") + (extra ? ` +${extra}` : "");
}

// ── Finding a version ───────────────────────────────────────────────────────

/** Which versions the list shows: every one, the ones the author named, or the ones not online yet. */
export type VersionFilter = "all" | "named" | "local";

/** A version the author saved: a landmark in the list. */
export function isNamed(message: string): boolean {
  return versionKind(message) === "manual";
}

/**
 * Whether a version is shown under `filter` and search `query`: the query
 * matches its title or note, or the name of a file it changed (known only
 * once its changes have loaded, `changes`).
 */
export function matchesVersion(
  entry: VersionEntry,
  filter: VersionFilter,
  query: string,
  changes?: VersionChanges,
): boolean {
  if (filter === "named" && !isNamed(entry.message)) return false;
  if (filter === "local" && entry.backedUp !== false) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.message.toLowerCase().includes(q) || versionTitle(entry.message).toLowerCase().includes(q)) return true;
  return !!changes?.files.some((f) => f.path.toLowerCase().includes(q));
}

/**
 * The file a version opens to: the one the author had open, when this
 * version changed it too; else its first text file; else its first file.
 */
export function pickFile(files: VersionFileChange[], wanted: string | null): string | null {
  if (wanted && files.some((f) => f.path === wanted)) return wanted;
  return (files.find((f) => f.text) ?? files[0])?.path ?? null;
}

/** The name most versions carry: rows name an author only when it is someone else. */
export function usualAuthor(entries: SnapshotEntry[]): string | null {
  const counts = new Map<string, number>();
  let best: string | null = null;
  for (const { author } of entries) {
    if (!author) continue;
    const n = (counts.get(author) ?? 0) + 1;
    counts.set(author, n);
    if (!best || n > counts.get(best)!) best = author;
  }
  return best;
}

/** "2 versions from Grace aren't on this computer yet": the banner over the list. */
export function onlineSummary(entries: SnapshotEntry[]): string {
  const authors = [...new Set(entries.map((e) => e.author).filter((a): a is string => !!a))];
  const names = authors.length > 1 ? `${authors.slice(0, -1).join(", ")} and ${authors[authors.length - 1]}` : authors[0];
  const from = names ? ` from ${names}` : "";
  return entries.length === 1
    ? `1 version${from} isn't on this computer yet`
    : `${entries.length} versions${from} aren't on this computer yet`;
}

/**
 * A version row's title: the author's own note when there is one ("Sent to
 * printer"), else the plain label ("Automatic version"); "Version saved by you— Edit 150" is gone.
 */
export function versionTitle(message: string): string {
  return versionDescription(message) ?? versionLabel(message);
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

/**
 * The Online tab's line for work the Main draft has and the open draft has not
 * (#524): "The Main draft has 4 changes this draft doesn't have yet." and
 * "by Hern · Yesterday, 4:46 PM".
 */
export function mainDraftLine(m: { count: number; authors: string[]; latestAt: number }, now: number): { title: string; by: string } {
  const title = `The Main draft has ${m.count} ${m.count === 1 ? "change" : "changes"} this draft doesn't have yet.`;
  const who = m.authors.length > 1 ? `${m.authors.slice(0, -1).join(", ")} and ${m.authors[m.authors.length - 1]}` : m.authors[0];
  return { title, by: `${who ? `by ${who} · ` : ""}${whenShort(m.latestAt, now)}` };
}

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
