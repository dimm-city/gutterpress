import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>>({
  call: async () =>
    handleRemoteErrors('remote:disconnectGitHub', async () => {
      await getHostServices().remote.tokenStore.delete(getHostServices().remote.GITHUB_HOST);
      return { ok: true };
    }),
});
