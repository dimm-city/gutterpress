import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async () => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    return json(
      await handleRemoteErrors('remote:listRepositories', async () => {
        const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
        if (!credential) {
          throw new Error('Connect GitHub first to see your repositories.');
        }
        const lib = await hooks.loadLib();
        if (!lib.listGitHubRepositories) {
          throw new Error('listGitHubRepositories not available in this version of the lib');
        }
        return lib.listGitHubRepositories(credential);
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
