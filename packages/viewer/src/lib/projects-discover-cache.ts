// ──────────────────────────────────────────────────────────────────────────
// Shared, deduped cache for app:discoverProjects (#27).
//
// The discover scan is a depth-3 filesystem BFS in the Electron main process
// — the most expensive call ProjectsListBody makes. Two instances of that
// component can mount at once (the start screen and the left panel's Projects
// tab), and the start screen remounts on every re-show, so without this
// module every launch ran two concurrent scans and every landing re-show ran
// another. One module-level cache means: concurrent callers share a single
// in-flight scan, and re-shows within the TTL reuse the last result. Recents
// and favorites stay uncached — they are cheap single-file reads and must
// reflect the open that just happened.
// ──────────────────────────────────────────────────────────────────────────
import { api } from "$lib/api";

export type DiscoveredProject = { path: string; title: string };

const TTL_MS = 60_000;

let cache: DiscoveredProject[] | null = null;
let cachedAt = 0;
let inflight: Promise<DiscoveredProject[]> | null = null;

export function discoverProjectsCached(): Promise<DiscoveredProject[]> {
  if (cache && Date.now() - cachedAt < TTL_MS) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = api.app
    .discoverProjects()
    .then((r) => {
      cache = r as DiscoveredProject[];
      cachedAt = Date.now();
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
