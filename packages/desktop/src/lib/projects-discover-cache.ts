// ──────────────────────────────────────────────────────────────────────────
// Shared, deduped cache for app:discoverProjects (#27).
//
// The discover scan is a depth-3 filesystem BFS in the Electron main process
// — the most expensive call ProjectsListBody makes. Two instances of that
// component can mount at once (the start screen and the left panel's Projects
// tab), and the start screen remounts on every re-show, so without this
// module every launch ran two concurrent scans and every landing re-show ran
// another. One module-level cache means: concurrent callers share a single
// in-flight scan, re-shows within the TTL reuse the last result, and events
// that change the discoverable set (create / adopt / clone) bust the cache
// explicitly via invalidateDiscoveredProjects(). Recents and favorites stay
// uncached — they are cheap single-file reads and must reflect the open that
// just happened.
// ──────────────────────────────────────────────────────────────────────────
import { discoverProjects } from "$lib/app-lifecycle/app-lifecycle-capability";
import type { DiscoveredProject } from "$lib/platform/dtos";

export type { DiscoveredProject };

const TTL_MS = 60_000;

let cache: DiscoveredProject[] | null = null;
let cachedAt = 0;
let inflight: Promise<DiscoveredProject[]> | null = null;

export function discoverProjectsCached(): Promise<DiscoveredProject[]> {
  if (cache && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight;

  const p = discoverProjects()
    .then((r) => {
      // If the cache was invalidated (or a newer scan started) while this scan
      // was in flight, don't repopulate the module cache with stale results.
      if (inflight !== p) return r;
      cache = r;
      cachedAt = Date.now();
      return cache;
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });

  inflight = p;
  return inflight;
}

/**
 * Drop the cached scan. Call after anything that changes the set of
 * discoverable projects — creating a book, adopting a folder, cloning from
 * GitHub — so the next list shows it without waiting out the TTL.
 */
export function invalidateDiscoveredProjects(): void {
  cache = null;
  cachedAt = 0;
  inflight = null;
}
