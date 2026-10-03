import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () =>
    handleRemoteErrors('remote:listRepositories', async () => {
      const credential = await getHostServices().remote.tokenStore.get(getHostServices().remote.GITHUB_HOST);
      if (!credential) {
        throw new Error('Connect GitHub first to see your repositories.');
      }
      const lib = await loadLib();
      return lib.listGitHubRepositories(credential);
    }),
});
