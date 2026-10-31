/**
 * Pure helpers for FileTree's per-directory children cache, and the rule for
 * which entries a listing keeps.
 *
 * `childrenByPath` is NOT a permanent cache: FileTree.svelte always refetches
 * on expand (no cache-hit short-circuit, which would hide folders
 * created/renamed/deleted in the app or externally until the project
 * reopened) and calls the invalidation helpers below right after its
 * own create/rename/delete calls so an EXPANDED folder updates immediately
 * without waiting for a re-toggle.
 *
 * No Svelte/runes here on purpose — these are plain, framework-free
 * functions over a `Record<string, T>` so the cache-key bookkeeping (in
 * particular the folder-subtree prefix match, which is easy to get subtly
 * wrong — see the sibling-prefix bug class CLAUDE.md's fs-guard work fixed
 * for path containment) is unit-testable in isolation from rendering and
 * host `api.fs.*` calls.
 */

import { isPathAtOrUnder } from "#lib/platform/paths.ts";

// The files the tree lists: the text files an author edits, and SVG figures
// (text too; they open as plain text). Folders are always listed, so the
// author can navigate into them.
const LISTED_FILE = /\.(md|markdown|yaml|yml|css|txt|svg)$/i;

/** Keep folders + listed files, folders first, each group alphabetical.
 *  Dot-entries (`.git`, `.git-damaged-…`, `.DS_Store`) are app/OS plumbing,
 *  never part of the writer's book — same rule as api/media/list-images. */
export function visibleEntries<T extends { name: string; isDir: boolean }>(raw: readonly T[]): T[] {
  return raw
    .filter((e) => !e.name.startsWith(".") && (e.isDir || LISTED_FILE.test(e.name)))
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

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
