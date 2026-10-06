import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ owner?: string; repo?: string }>({
  call: async ({ body }) =>
    handleRemoteErrors('remote:listBranches', async () => {
      if (
        typeof body?.owner !== 'string' ||
        typeof body?.repo !== 'string' ||
        !body.owner ||
        !body.repo
      ) {
        throw new Error('remote:listBranches requires owner and repo');
      }
      const credential = await getHostServices().remote.tokenStore.get(getHostServices().remote.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your repositories.');
      }
      const lib = await loadLib();
      return lib.listGitHubBranches(credential, body.owner, body.repo);
    }),
});
