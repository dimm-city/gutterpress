import type { SnapshotEntry } from "$lib/api";

/**
 * Writer-facing view helpers for the "Previous versions" timeline
 * (ProjectActivityView). `SnapshotEntry` has no `kind` field, so the stored
 * `message` string is the ONLY discriminator the renderer has. The machine
 * messages below are produced by the CLI lib and the vcs routes; they are
 * matched as LITERAL strings — never imported — both because the SPA never
 * value-imports the lib (§8 / ADR 0004) and because superseded spellings live
 * in existing project history forever, so every spelling ever shipped stays
 * listed. Anything unrecognized is a version the author saved by hand. Pure,
 * no runes — mirrors outline.ts / toc-tree.ts and is unit-tested directly.
 */
export type VersionKind = "automatic" | "combined" | "created" | "manual";

/** Backup-style machine messages (collapsible into one row per run). */
const AUTOMATIC_MESSAGES = new Set<string>([
  // source-provider AUTO_SNAPSHOT_MESSAGE (host-scheduled saves)
  "Automatic snapshot",
  // sync-messages SYNC_SNAPSHOT_MESSAGE (pre-sync backup, 0.10.1+)…
  "Automatic backup of your work",
  // …and its pre-0.10.1 spelling
  "Snapshot before syncing",
  // sync-messages SYNC_LATE_EDIT_MESSAGE (edit landed mid-sync)
  "Saved the edit you made while syncing",
  // source-provider RESTORE_BACKUP_MESSAGE (pre-restore safety copy)
  "Automatic backup before restoring an earlier version",
  // converge-merge CONVERGE_PREPARE_MESSAGE (pre-combine equalization)
  "Getting your changes ready to combine with the online version",
]);

/** What a sync's merge recorded (converge-merge's commit messages). */
const COMBINED_MESSAGES = new Set<string>([
  // CONVERGE_MERGE_MESSAGE
  "Combined your changes with the online version",
  // CONVERGE_RESTORE_MESSAGE (kept-both restore)
  "Kept both versions of the files that can't be combined",
]);

/** History-start commits (enable-version-history route, project-scaffold). */
const CREATED_MESSAGES = new Set<string>([
  "Initial snapshot",
  "Created project",
  "Set up as a gutterpress book",
]);

export function versionKind(message: string): VersionKind {
  if (CREATED_MESSAGES.has(message)) return "created";
  if (AUTOMATIC_MESSAGES.has(message)) return "automatic";
  if (COMBINED_MESSAGES.has(message)) return "combined";
  return "manual";
}

/** The plain-language row title shown to writers. */
export function versionLabel(message: string): string {
  switch (versionKind(message)) {
    case "automatic":
      return "Automatic backup";
    case "combined":
      return "Combined with the online copy";
    case "created":
      return "Project created";
    case "manual":
      return "Version saved by you";
  }
}

/**
 * The author's own note for a manual save (shown as a second line). Machine
 * entries carry only their recorded message, which the label already conveys,
 * so they get no description — and neither does the save-a-version route's
 * "Saved snapshot" placeholder (a manual save, but not an author note).
 */
export function versionDescription(message: string): string | null {
  if (versionKind(message) !== "manual") return null;
  if (message === "Saved snapshot") return null;
  return message;
}

export interface VersionDay {
  /** Stable local-day key (yyyy-m-d) for `{#each}` keying. */
  key: string;
  /** Human day heading: "Today", "Yesterday", or a written date. */
  label: string;
  entries: SnapshotEntry[];
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
export function groupVersionsByDay(entries: SnapshotEntry[], now: number): VersionDay[] {
  const days: VersionDay[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.timestamp);
    const last = days[days.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else days.push({ key, label: dayLabel(entry.timestamp, now), entries: [entry] });
  }
  return days;
}

// ── Collapsed automatic runs ─────────────────────────────────────────────────

/** One renderable timeline row: a single version, or a run of automatic backups. */
export type TimelineRow =
  | { kind: "entry"; key: string; entry: SnapshotEntry }
  | { kind: "auto-run"; key: string; entries: SnapshotEntry[] };

/**
 * Fold 2+ consecutive automatic backups into one expandable row, so a
 * sync-heavy writing day reads as one line instead of hundreds. A pure
 * display transform over one day's (newest-first) entries — restore still
 * targets the individual entries inside the run. A run is keyed by its
 * OLDEST entry so its identity survives newer backups prepending.
 */
export function collapseAutomaticRuns(entries: SnapshotEntry[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let run: SnapshotEntry[] = [];
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

/** "Backed up automatically · 9:02 AM–1:14 PM · 84 times" (entries newest-first). */
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
  return `Backed up automatically · ${span} · ${entries.length} times`;
}
