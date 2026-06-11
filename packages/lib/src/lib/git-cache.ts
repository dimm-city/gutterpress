/**
 * Per-repository isomorphic-git object cache (the library's documented
 * big-win mechanism: https://isomorphic-git.org/docs/en/cache).
 *
 * WHY: without a shared `cache`, EVERY isomorphic-git call re-reads and
 * re-parses the repository's packfile indexes from scratch. On a large repo
 * (measured on a 2 GB `.git`, 5k commits) a single `statusMatrix` costs
 * ~2.1–2.7 s cold and ~30 ms with a warm cache — a 70–100× difference. The
 * history/sync dialogs each issue several git reads per open, so reusing one
 * cache per repo is what makes them feel instant.
 *
 * Staleness/safety (verified against isomorphic-git 1.38 internals):
 *   - The index cache (`IndexCache`) self-invalidates by comparing the
 *     `.git/index` file's stats on every acquire, so changes written by an
 *     external `git` process are picked up automatically.
 *   - The packfile cache (`PackfileCache`) is keyed by content-addressed
 *     pack filenames (immutable by definition), and the pack directory is
 *     re-listed (`readdir`) on every object lookup — packs added by an
 *     external fetch/gc are discovered fresh; deleted packs leave only dead
 *     (never-consulted) map entries.
 *
 * MEMORY: the packfile cache lazily holds whole pack buffers (≈1.4 GB RSS on
 * the repo above), so the cache must NOT live forever. Entries are dropped
 * after a sliding idle TTL ({@link REPO_CACHE_TTL_MS}) and the map is capped
 * at {@link REPO_CACHE_MAX_REPOS} repos (least-recently-used evicted first).
 * Within a dialog session everything stays hot; after a few idle minutes the
 * memory is reclaimed by GC.
 */
import path from "node:path";

/** Idle time after which a repo's cache is dropped (sliding, per access). */
export const REPO_CACHE_TTL_MS = 5 * 60_000;
/** Most repos kept warm at once (viewer realistically uses 1–2). */
export const REPO_CACHE_MAX_REPOS = 4;

interface CacheEntry {
  cache: Record<string, unknown>;
  timer: ReturnType<typeof setTimeout>;
}

const repoCaches = new Map<string, CacheEntry>();

function armTimer(key: string, entry: CacheEntry): void {
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    repoCaches.delete(key);
  }, REPO_CACHE_TTL_MS);
  // Never keep the process alive just to evict a cache.
  entry.timer.unref?.();
}

/**
 * The shared isomorphic-git `cache` object for a repository root. Pass the
 * SAME object to every `git.*` call against that repo. Accessing it slides
 * the idle-eviction window.
 */
export function getRepoCache(repoRoot: string): Record<string, unknown> {
  const key = path.resolve(repoRoot);
  let entry = repoCaches.get(key);
  if (!entry) {
    entry = { cache: {}, timer: setTimeout(() => {}, 0) };
    repoCaches.set(key, entry);
    // LRU cap: Map preserves insertion order; re-inserting on access (below)
    // keeps the oldest-used entry first.
    while (repoCaches.size > REPO_CACHE_MAX_REPOS) {
      const oldest = repoCaches.keys().next().value;
      if (oldest === undefined) break;
      const old = repoCaches.get(oldest);
      if (old) clearTimeout(old.timer);
      repoCaches.delete(oldest);
    }
  } else {
    // Refresh LRU position.
    repoCaches.delete(key);
    repoCaches.set(key, entry);
  }
  armTimer(key, entry);
  return entry.cache;
}

/**
 * Drop the cached state for a repository (e.g. after an operation known to
 * have rewritten the repo wholesale, or from tests). Safe to call for repos
 * that have no cache.
 */
export function invalidateRepoCache(repoRoot: string): void {
  const key = path.resolve(repoRoot);
  const entry = repoCaches.get(key);
  if (entry) clearTimeout(entry.timer);
  repoCaches.delete(key);
}

/** Number of repos currently cached (test/diagnostic helper). */
export function repoCacheSize(): number {
  return repoCaches.size;
}
