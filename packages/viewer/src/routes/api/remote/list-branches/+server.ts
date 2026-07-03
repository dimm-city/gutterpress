import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { owner?: string; repo?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:listBranches', async () => {
    if (
      typeof body?.owner !== 'string' ||
      typeof body?.repo !== 'string' ||
      !body.owner ||
      !body.repo
    ) {
      throw new Error('remote:listBranches requires owner and repo');
    }
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error('Connect GitHub first to see your repositories.');
    }
    const lib = await hooks.loadLib();
    if (!lib.listGitHubBranches) {
      throw new Error('listGitHubBranches not available in this version of the lib');
    }
    return lib.listGitHubBranches(credential, body.owner, body.repo);
  });
});
