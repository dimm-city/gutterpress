// ──────────────────────────────────────────────────────────────────────────
// recent-folders.ts — pure persistence transforms for the Open Location modal.
//
// These operate on the recentFolders / favorites arrays stored in
// viewer-prefs.json. They are intentionally side-effect-free (no electron, no
// filesystem) so main.ts can reuse its existing readPrefs()/writePrefs()
// helpers AND so the logic is unit-testable in isolation.
// ──────────────────────────────────────────────────────────────────────────

export interface RecentFolder {
  path: string;
  title: string;
  openedAt: string; // ISO-8601
  /**
   * C2 (book switcher): for a repo-backed project, `path` is the REPO ROOT
   * (the git-scoped project unit), and this is the absolute folder of the book
   * that was actually active when the entry was recorded — so reopening
   * restores that book instead of falling back to the alphabetically-first one.
   * Absent for a standalone (non-git) project, where `path` already IS the
   * opened folder.
   */
  lastActiveBook?: string;
}

export interface FavoriteFolder {
  path: string;
  title: string;
}

/** Newest-first cap for the recent-folders list. */
export const RECENT_FOLDERS_CAP = 8;

/**
 * Upsert a folder into the recent list: move-to-front, dedupe by path, refresh
 * title + openedAt, cap at RECENT_FOLDERS_CAP (newest first).
 */
export function upsertRecentFolder(
  recents: RecentFolder[] | undefined,
  entry: RecentFolder
): RecentFolder[] {
  const rest = (recents ?? []).filter((r) => r.path !== entry.path);
  return [entry, ...rest].slice(0, RECENT_FOLDERS_CAP);
}

/** Remove a folder from the recent list by path. */
export function removeRecentFolder(
  recents: RecentFolder[] | undefined,
  targetPath: string
): RecentFolder[] {
  return (recents ?? []).filter((r) => r.path !== targetPath);
}

/**
 * Toggle a folder's favorite status by path. Returns the new list plus whether
 * the folder is now favorited. Re-favoriting refreshes the stored title.
 */
export function toggleFavoriteFolder(
  favorites: FavoriteFolder[] | undefined,
  entry: FavoriteFolder
): { favorites: FavoriteFolder[]; favorited: boolean } {
  const existing = favorites ?? [];
  const isFav = existing.some((f) => f.path === entry.path);
  if (isFav) {
    return {
      favorites: existing.filter((f) => f.path !== entry.path),
      favorited: false,
    };
  }
  return {
    favorites: [...existing, { path: entry.path, title: entry.title }],
    favorited: true,
  };
}
