/**
 * What the Online tab last read for each book (the first page of versions,
 * what the newest of them changed, the edits not in a version yet and the
 * versions online not here yet), kept for the life of the app. Reopening the
 * tab paints this at once and swaps in fresh data when the quiet background
 * read lands, so the cards never blank out and reload.
 *
 * Plain TypeScript (no runes) so it is unit-tested directly.
 */
import type { OnlineVersionEntry, VersionChanges, VersionEntry } from "#lib/platform/contract.ts";

export interface OnlineViewSnapshot {
  /** The first page of Version history (shared with the Version history screen). */
  page: { entries: VersionEntry[]; hasMore: boolean } | null;
  /** What a version changed, by id (a version never changes, so it is looked up once). */
  changes: Record<string, VersionChanges>;
  facts: { lastVersionAt: number | null; changedFiles: number | null; stale: boolean } | null;
  /** Online, not saved here yet; null = not known yet. */
  incoming: OnlineVersionEntry[] | null;
  /** Why the online side could not be read this time, when it could not. */
  incomingReason?: "no-remote" | "auth" | "not-found" | "offline";
  /** When the online side was last read successfully (ms). */
  incomingAt: number | null;
}

const snapshots = new Map<string, OnlineViewSnapshot>();

export const peek = (dir: string): OnlineViewSnapshot | undefined => snapshots.get(dir);

/** Merge new fields into a book's snapshot. */
export function update(dir: string, patch: Partial<OnlineViewSnapshot>): OnlineViewSnapshot {
  const next: OnlineViewSnapshot = { page: null, changes: {}, facts: null, incoming: null, incomingAt: null, ...snapshots.get(dir), ...patch };
  snapshots.set(dir, next);
  return next;
}

export const clear = (dir?: string): void => (dir ? void snapshots.delete(dir) : snapshots.clear());
