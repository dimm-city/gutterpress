/**
 * git-read-cache.ts — one isomorphic-git object cache per repository, shared
 * by the read-only history views (Version history, the Online tab).
 *
 * isomorphic-git reads a whole packfile into the cache the first time any
 * object in it is read. A fresh cache per call therefore re-reads the pack on
 * every call: about 0.3–1 s a call on a book whose pack is a few hundred MB of
 * images, where a warm cache answers in milliseconds. Sharing one keeps the
 * pack in memory, so it is bounded:
 *
 *  - a repository's cache is dropped once it has gone {@link IDLE_MS} without
 *    a read, so a book left alone holds no pack;
 *  - it starts afresh whenever the set of pack files changes (a fetch, a gc,
 *    a new pack), so it never keeps a pack that is gone or misses a new one.
 *
 * Only reads of commits, trees and blobs use it (history, a version's changes,
 * a file at a version, the tree written for Pages, revisions). Anything that
 * writes (snapshot, checkout, restore, sync) or reads the index (the
 * unsaved-changes count) keeps a cache of its own for that one operation: the
 * index cache isomorphic-git keeps beside the packs must not outlive a write
 * (see `SnapshotOptions.cache` in source-provider.ts).
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

/** How long a repository's cache is kept with no read. */
export const IDLE_MS = 60_000;

interface Shared {
  cache: Record<string, unknown>;
  /** The pack files the cache was made with. */
  packs: string;
  timer: ReturnType<typeof setTimeout>;
}

const shared = new Map<string, Shared>();

/** The shared object cache for reads in repository `dir`. */
export async function gitReadCache(dir: string): Promise<Record<string, unknown>> {
  const key = path.resolve(dir);
  const names = await readdir(path.join(key, ".git", "objects", "pack")).catch(() => [] as string[]);
  const packs = names.filter((n) => n.endsWith(".pack")).sort().join("\n");
  const have = shared.get(key);
  if (have?.packs === packs) {
    have.timer.refresh();
    return have.cache;
  }
  if (have) clearTimeout(have.timer);
  const timer = setTimeout(() => shared.delete(key), IDLE_MS);
  // A cache waiting to be dropped never keeps the process alive.
  timer.unref?.();
  const next = { cache: {}, packs, timer };
  shared.set(key, next);
  return next.cache;
}
