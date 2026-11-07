import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { cachedRepositoryPage, rememberRepositoryPage } from '../../_lib/repo-pages';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';


/**
 * Without `page`: every repository (the original behaviour, an array). With
 * `page` (1-based): just that page of up to 100, `{ repos, page, hasMore }`, so
 * the picker can show the first page at once and ask for the rest in the
 * background. Pages are cached for a minute per account; `refresh` bypasses it.
 */
export const POST: RequestHandler = defineRoute<{ page: number | null; refresh: boolean }>({
  validate: (raw) => {
    const body = (raw ?? {}) as { page?: unknown; refresh?: unknown };
    const page = typeof body.page === 'number' && Number.isInteger(body.page) && body.page >= 1 ? body.page : null;
    return { page, refresh: body.refresh === true };
  },
  call: async ({ body }) =>
    handleRemoteErrors('remote:listRepositories', async () => {
      const credential = await getHostServices().remote.tokenStore.get(getHostServices().remote.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your online copies.');
      }
      const lib = await loadLib();
      if (body.page === null) return lib.listGitHubRepositories(credential);
      // Keyed by the account's token tail: a different sign-in is a different list.
      const key = `${credential.token.slice(-12)}:${body.page}`;
      const hit = body.refresh ? null : cachedRepositoryPage(key);
      if (hit) return hit;
      const value = await lib.listGitHubRepositoriesPage(credential, body.page);
      rememberRepositoryPage(key, value);
      return value;
    }),
});
