import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  owner?: string;
  repo?: string;
  branch?: string;
}) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:listRepoBooks', async () => {
    if (
      typeof body?.owner !== 'string' ||
      typeof body?.repo !== 'string' ||
      typeof body?.branch !== 'string' ||
      !body.owner ||
      !body.repo ||
      !body.branch
    ) {
      throw new Error('remote:listRepoBooks requires owner, repo and branch');
    }
    const credential = await hooks.tokenStore.get(hooks.GITHUB_HOST);
    if (!credential) {
      throw new Error('Connect GitHub first to see your repositories.');
    }
    const lib = await hooks.loadLib();
    if (!lib.listRepoBooks) {
      throw new Error('listRepoBooks not available in this version of the lib');
    }
    return lib.listRepoBooks(credential, body.owner, body.repo, body.branch);
  });
});
