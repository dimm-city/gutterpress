import type { SnapshotEntry } from "$lib/api";

/**
 * Writer-facing view helpers for the "Previous versions" timeline
 * (ProjectActivityView). `SnapshotEntry` has no `kind` field, so the stored
 * `message` string is the ONLY discriminator the renderer has for
 * automatic-vs-manual-vs-initial. The two sentinel messages are produced by
 * the CLI lib (source-provider's AUTO_SNAPSHOT_MESSAGE = "Automatic snapshot"
 * and the enable-version-history route's initialMessage = "Initial snapshot");
 * anything else is a version the author saved by hand. Pure, no runes —
 * mirrors outline.ts / toc-tree.ts and is unit-tested directly.
 */
export type VersionKind = "automatic" | "created" | "manual";

export function versionKind(message: string): VersionKind {
  if (message === "Automatic snapshot") return "automatic";
  if (message === "Initial snapshot") return "created";
  return "manual";
}

/** The plain-language row title shown to writers. */
export function versionLabel(message: string): string {
  switch (versionKind(message)) {
    case "automatic":
      return "Automatic version";
    case "created":
      return "Project created";
    case "manual":
      return "Version saved by you";
  }
}

/**
 * The author's own note for a manual save (shown as a second line). Automatic
 * and initial versions carry only their sentinel message, which the label
 * already conveys, so they get no description.
 */
export function versionDescription(message: string): string | null {
  return versionKind(message) === "manual" ? message : null;
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
