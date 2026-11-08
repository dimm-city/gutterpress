/**
 * What the Online tab last showed for each book (version list and waiting
 * changes), kept for the life of the app. Reopening the tab paints this at
 * once and swaps in fresh data when the quiet background read lands, so the
 * lists never blank out and reload.
 *
 * Plain TypeScript (no runes) so it is unit-tested directly.
 */
import type { VersionEntry } from "#lib/platform/contract.ts";

/** One saved change waiting to travel, in plain words. */
export interface WaitingChange {
  id: string;
  at: number;
  /** The author's own note, or null for an automatic version. */
  note: string | null;
  /** Who made it, when known. */
  author?: string;
  /** Plain names of the files it changed (a few). */
  files: string[];
  /** More changed files than listed. */
  more: number;
}

export interface OnlineViewSnapshot {
  recent: VersionEntry[];
  facts: { lastVersionAt: number | null; changedFiles: number | null; stale: boolean } | null;
  /** Saved here, not online yet. */
  local: WaitingChange[];
  /** Online, not saved here yet; null = not known yet. */
  incoming: WaitingChange[] | null;
  /** Why the online side could not be read this time, when it could not. */
  incomingReason?: "no-remote" | "auth" | "not-found" | "offline";
  /** When the online side was last read successfully (ms). */
  incomingAt: number | null;
}

const snapshots = new Map<string, OnlineViewSnapshot>();

export const peek = (dir: string): OnlineViewSnapshot | undefined => snapshots.get(dir);

/** Merge new fields into a book's snapshot. */
export function update(dir: string, patch: Partial<OnlineViewSnapshot>): OnlineViewSnapshot {
  const next: OnlineViewSnapshot = { recent: [], facts: null, local: [], incoming: null, incomingAt: null, ...snapshots.get(dir), ...patch };
  snapshots.set(dir, next);
  return next;
}

export const clear = (dir?: string): void => (dir ? void snapshots.delete(dir) : snapshots.clear());

/** "chapters/02-the-river.md" -> "The river" (a plain name; no folders or extension). */
export function plainFileName(path: string): string {
  const base = path.split("/").pop() ?? path;
  const stem = base.replace(/\.[^.]+$/, "").replace(/^\d+[-_ ]+/, "").replace(/[-_]+/g, " ").trim();
  const name = stem || base;
  return name.charAt(0).toUpperCase() + name.slice(1);
}
