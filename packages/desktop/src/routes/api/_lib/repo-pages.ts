/** Pages of the account's repository list, cached briefly so the picker opens at once. */
export type RepoPage = { repos: unknown[]; page: number; hasMore: boolean };

const PAGE_CACHE_MS = 60_000;
const pages = new Map<string, { at: number; value: RepoPage }>();

export function cachedRepositoryPage(key: string): RepoPage | null {
  const hit = pages.get(key);
  return hit && Date.now() - hit.at < PAGE_CACHE_MS ? hit.value : null;
}

export function rememberRepositoryPage(key: string, value: RepoPage): void {
  pages.set(key, { at: Date.now(), value });
}

/** An online copy was created (or the account changed): the list is out of date. */
export function forgetRepositoryPages(): void {
  pages.clear();
}
