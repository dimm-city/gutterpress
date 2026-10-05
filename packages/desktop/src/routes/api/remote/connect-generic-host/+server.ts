import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ host?: string; username?: string; token?: string; repoUrl?: string }>({
  call: async ({ body }) =>
    handleRemoteErrors('remote:connectGenericHost', async () => {
      if (
        !body ||
        typeof body.host !== 'string' ||
        typeof body.token !== 'string' ||
        !body.host.trim() ||
        !body.token.trim()
      ) {
        throw new Error('remote:connectGenericHost requires { host, token }');
      }
      const lib = await loadLib();
      // Validates with a refs probe BEFORE returning — a bad paste never
      // reaches the credential store.
      const credential = await lib.connectGenericHost({
        host: body.host,
        ...(body.username ? { username: body.username } : {}),
        token: body.token,
        ...(body.repoUrl ? { repoUrl: body.repoUrl } : {}),
      });
      await getHostServices().remote.tokenStore.set(credential.host, credential);
      // Response must NOT include the token — only redacted status.
      return {
        connected: true,
        host: credential.host,
        ...(credential.username ? { username: credential.username } : {}),
      };
    }),
});
