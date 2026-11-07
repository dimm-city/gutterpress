/**
 * The GitHub account's online copies, kept for the session (UX review §2.3
 * item 6): the "Open from GitHub" picker and the backup wizard's "Use one I
 * already made" show the last list at once and refresh it behind the scenes,
 * instead of waiting for every page each time. It is filled as soon as a
 * sign-in finishes.
 *
 * The list is kept per account (so a different sign-in never shows the
 * previous account's books) and forgotten on any disconnect. When the host
 * answers in pages the caller gets every page it had, once per full name.
 *
 * Plain TypeScript, unit-tested with a fake read.
 */
import { api } from "#lib/api.ts";
import type { RemoteRepository } from "#lib/platform/contract.ts";

export type ReadRepositories = (options?: { refresh?: boolean }) => Promise<RemoteRepository[]>;

/** The same repository can arrive on two pages when something is pushed meanwhile. */
export function dedupeByFullName(repos: RemoteRepository[]): RemoteRepository[] {
  const seen = new Set<string>();
  return repos.filter((r) => (seen.has(r.fullName) ? false : (seen.add(r.fullName), true)));
}

export function createRepoListCache(read: ReadRepositories) {
  const lists = new Map<string, RemoteRepository[]>();
  const running = new Map<string, Promise<RemoteRepository[]>>();

  function refresh(account: string, options?: { refresh?: boolean }): Promise<RemoteRepository[]> {
    const have = running.get(account);
    if (have) return have;
    const p = read(options)
      .then((r) => {
        const list = dedupeByFullName(r);
        lists.set(account, list);
        return list;
      })
      .finally(() => running.delete(account));
    running.set(account, p);
    return p;
  }

  return {
    /** The last list for this account, or null when none has been read this session. */
    peek: (account: string): RemoteRepository[] | null => lists.get(account) ?? null,
    /** Read the list now (a read already running for the account is shared). */
    refresh,
    /** Fill the cache without waiting for it (right after sign-in). */
    prefetch(account: string): void {
      if (!lists.has(account)) void refresh(account).catch(() => undefined);
    },
    /** Sign-out or Disconnect: no account's list is kept. */
    clear(): void {
      lists.clear();
      running.clear();
    },
  };
}

type Paged = { listRemoteRepositoriesPage?: (o: { page?: number; refresh?: boolean }) => Promise<{ repos: RemoteRepository[]; hasMore: boolean }> };

/** Every page the host will give (its paged call when it has one), else the whole list as before. */
async function readAll(options?: { refresh?: boolean }): Promise<RemoteRepository[]> {
  const paged = (api.remote as unknown as Paged).listRemoteRepositoriesPage;
  if (!paged) return (await api.remote.listRemoteRepositories()) as RemoteRepository[];
  const all: RemoteRepository[] = [];
  for (let page = 1; page <= 50; page++) {
    const r = await paged({ page, ...(options?.refresh && page === 1 ? { refresh: true } : {}) });
    all.push(...r.repos);
    if (!r.hasMore) break;
  }
  return all;
}

const shared = createRepoListCache(readAll);
export const peekRepositories = shared.peek;
export const refreshRepositories = shared.refresh;
export const prefetchRepositories = shared.prefetch;
export const clearRepositories = shared.clear;
