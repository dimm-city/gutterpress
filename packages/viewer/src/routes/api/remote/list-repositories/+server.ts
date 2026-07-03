import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:listRepositories', async () => {
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error('Connect GitHub first to see your repositories.');
    }
    const lib = await hooks.loadLib();
    if (!lib.listGitHubRepositories) {
      throw new Error('listGitHubRepositories not available in this version of the lib');
    }
    return lib.listGitHubRepositories(credential);
  });
});
