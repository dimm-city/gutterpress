import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ owner?: string; repo?: string; branch?: string }>({
  call: async ({ body }) =>
    handleRemoteErrors('remote:listRepoBooks', async () => {
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
      const credential = await getHostServices().remote.tokenStore.get(getHostServices().remote.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your repositories.');
      }
      const lib = await loadLib();
      return lib.listRepoBooks(credential, body.owner, body.repo, body.branch);
    }),
});
