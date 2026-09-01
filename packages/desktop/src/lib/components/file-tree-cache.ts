/**
 * Pure helpers for FileTree's per-directory children cache (UX review M9).
 *
 * `childrenByPath` used to be a PERMANENT cache — `loadChildren` early-
 * returned whenever a directory had already been fetched once, so a folder
 * created/renamed/deleted (from inside the app OR externally — a git pull,
 * an external editor) never showed up again until the whole project was
 * reopened. FileTree.svelte now always refetches on expand (no cache-hit
 * short-circuit) and calls the invalidation helpers below right after its
 * own create/rename/delete calls so an EXPANDED folder updates immediately
 * without waiting for a re-toggle.
 *
 * No Svelte/runes here on purpose — these are plain, framework-free
 * functions over a `Record<string, T>` so the cache-key bookkeeping (in
 * particular the folder-subtree prefix match, which is easy to get subtly
 * wrong — see the sibling-prefix bug class CLAUDE.md's fs-guard work fixed
 * for path containment) is unit-testable in isolation from rendering and
 * host `$lib/files/files-capability` calls.
 */

import { isPathAtOrUnder } from "$lib/platform/paths";

/** Drop exactly one directory's cached listing so its next expand refetches. */
export function invalidateDir<T>(cache: Record<string, T>, dir: string): Record<string, T> {
  if (!(dir in cache)) return cache;
  const next = { ...cache };
  delete next[dir];
  return next;
}

/**
 * Drop `dir`'s cached listing AND every cached descendant directory under it.
 * A folder rename/delete invalidates its whole cached subtree, not just its
 * own entry — a stale grandchild cache would otherwise keep showing entries
 * for a path that no longer exists (delete) or has moved (rename).
 */
export function invalidateSubtree<T>(cache: Record<string, T>, dir: string): Record<string, T> {
  // `isPathAtOrUnder` (platform/paths.ts) is the single source of truth for this
  // check. A local copy here appended only "/" when `dir` lacked a separator, so
  // on Windows a backslash-separated child never matched its own parent and the
  // subtree's cached listings survived a rename/delete — while the editor-buffer
  // check in +page.svelte, which used the shared helper, correctly matched.
  const keys = Object.keys(cache).filter((k) => isPathAtOrUnder(k, dir));
  if (keys.length === 0) return cache;
  const next = { ...cache };
  for (const k of keys) delete next[k];
  return next;
}

/** Remove `dir` from an `expanded` Set (a deleted folder can't stay expanded). */
export function collapseDir(expanded: ReadonlySet<string>, dir: string): Set<string> {
  if (!expanded.has(dir)) return new Set(expanded);
  const next = new Set(expanded);
  next.delete(dir);
  return next;
}

/** Re-key an expanded folder from its old path to its new one (rename). */
export function renameExpanded(
  expanded: ReadonlySet<string>,
  oldDir: string,
  newDir: string,
): Set<string> {
  if (!expanded.has(oldDir)) return new Set(expanded);
  const next = new Set(expanded);
  next.delete(oldDir);
  next.add(newDir);
  return next;
}
