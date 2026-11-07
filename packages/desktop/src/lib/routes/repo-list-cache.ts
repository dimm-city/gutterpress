/**
 * The GitHub account's online copies, kept for the session (UX review §2.3
 * item 6): the "Open from GitHub" picker and the backup wizard's "Use one I
 * already made" show the last list at once and refresh it behind the scenes,
 * instead of waiting for every page each time. It is filled as soon as a
 * sign-in finishes. The host may send the list in pages later; either way the
 * caller gets whatever list the host has answered with.
 *
 * Plain TypeScript, unit-tested with a fake read.
 */
import { api } from "#lib/api.ts";
import type { RemoteRepository } from "#lib/platform/contract.ts";

export type ReadRepositories = () => Promise<RemoteRepository[] | { repositories?: RemoteRepository[]; repos?: RemoteRepository[] }>;

const listOf = (r: Awaited<ReturnType<ReadRepositories>>): RemoteRepository[] =>
  Array.isArray(r) ? r : (r.repositories ?? r.repos ?? []);

export function createRepoListCache(read: ReadRepositories) {
  let repos: RemoteRepository[] | null = null;
  let running: Promise<RemoteRepository[]> | null = null;

  function fetchRepos(): Promise<RemoteRepository[]> {
    if (running) return running;
    const p = read()
      .then((r) => (repos = listOf(r)))
      .finally(() => {
        running = null;
      });
    running = p;
    return p;
  }

  return {
    /** The last list, or null when none has been read this session. */
    peek: (): RemoteRepository[] | null => repos,
    /** Read the list now (a read already running is shared). */
    refresh: fetchRepos,
    /** Fill the cache without waiting for it (right after sign-in). */
    prefetch(): void {
      if (!repos) void fetchRepos().catch(() => undefined);
    },
    /** Sign-out, or a different account. */
    clear(): void {
      repos = null;
    },
  };
}

const shared = createRepoListCache(() => api.remote.listRemoteRepositories());
export const peekRepositories = shared.peek;
export const refreshRepositories = shared.refresh;
export const prefetchRepositories = shared.prefetch;
export const clearRepositories = shared.clear;
