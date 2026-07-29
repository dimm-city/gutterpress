// ──────────────────────────────────────────────────────────────────────────
// discover-projects.ts — shallow background scan for Gutterpress projects (#27).
//
// A folder is a Gutterpress project candidate if it directly contains a filename
// from the lib's `MANIFEST_FILENAMES`. We do a breadth-first scan of the
// configured search roots, capped at depth ≤ 3 and a small result limit, so
// the scan stays cheap even across large home directories.
//
// The scan logic is injectable (readdir/exists) so it is unit-testable without
// touching the real filesystem or electron. main.ts wires the node:fs/promises
// implementations.
// ──────────────────────────────────────────────────────────────────────────

import { MANIFEST_FILENAMES } from "gutterpress";

export interface DiscoveredProject {
  path: string;
  title: string;
}

/** Maximum directory depth (root = depth 0). */
export const DISCOVER_MAX_DEPTH = 3;

/** Stop the scan once this many candidates have been collected. */
export const DISCOVER_MAX_RESULTS = 50;

/** Directory basenames that are never worth descending into. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".svelte-kit",
  "dist",
  "build",
  "out",
  ".cache",
  ".Trash",
  "Library",
]);

export interface ScanDeps {
  /** List immediate child entries of `dir`, separating sub-directory names. */
  listDirs(dir: string): Promise<string[]>;
  /** True if `filePath` exists and is a regular file. */
  fileExists(filePath: string): Promise<boolean>;
  /** Join path segments (host-appropriate separator). */
  join(...segments: string[]): string;
  /** Basename of a path. */
  basename(p: string): string;
}

function basenameTitle(deps: ScanDeps, dir: string): string {
  return deps.basename(dir) || dir;
}

/**
 * Breadth-first scan of `roots` for folders containing a Gutterpress manifest.
 * Excludes any path present in `exclude` (already in recents/favorites).
 * Deduplicates results by path. Returns at most DISCOVER_MAX_RESULTS entries.
 */
export async function scanForProjects(
  roots: string[],
  exclude: Iterable<string>,
  deps: ScanDeps,
): Promise<DiscoveredProject[]> {
  const excludeSet = new Set(exclude);
  const seen = new Set<string>();
  const results: DiscoveredProject[] = [];

  // Queue of [dir, depth]. Roots themselves are scanned (depth 0).
  let frontier: Array<[string, number]> = [];
  for (const root of roots) {
    if (!seen.has(root)) {
      seen.add(root);
      frontier.push([root, 0]);
    }
  }

  while (frontier.length > 0 && results.length < DISCOVER_MAX_RESULTS) {
    const next: Array<[string, number]> = [];
    for (const [dir, depth] of frontier) {
      if (results.length >= DISCOVER_MAX_RESULTS) break;

      // Is this directory itself a project?
      if (!excludeSet.has(dir)) {
        let isProject = false;
        for (const name of MANIFEST_FILENAMES) {
          if (await deps.fileExists(deps.join(dir, name))) {
            isProject = true;
            break;
          }
        }
        if (isProject) {
          results.push({ path: dir, title: basenameTitle(deps, dir) });
        }
      }

      // Descend into children if we still have depth budget.
      if (depth < DISCOVER_MAX_DEPTH) {
        let children: string[];
        try {
          children = await deps.listDirs(dir);
        } catch {
          continue; // unreadable dir — skip silently
        }
        for (const child of children) {
          if (SKIP_DIRS.has(child) || child.startsWith(".")) continue;
          const childPath = deps.join(dir, child);
          if (seen.has(childPath)) continue;
          seen.add(childPath);
          next.push([childPath, depth + 1]);
        }
      }
    }
    frontier = next;
  }

  return results;
}
