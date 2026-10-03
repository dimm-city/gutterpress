import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ url?: string }>({
  call: async ({ body }) =>
    handleRemoteErrors('remote:testRemoteAccess', async () => {
      if (typeof body?.url !== 'string' || !body.url.trim()) {
        throw new Error('remote:testRemoteAccess requires a remote URL');
      }
      const lib = await loadLib();
      // Use the stored credential for the remote's host, when one exists.
      // Credentials are keyed hostname[:port]; a self-hosted forge on a port
      // still resolves. SSH/scp-like URLs don't parse — lib classifies without auth.
      const { tokenStore } = getHostServices().remote;
      let credential: Awaited<ReturnType<typeof tokenStore.get>> = null;
      try {
        const u = new URL(body.url);
        const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
        credential = await tokenStore.get(host);
      } catch {
        // SSH/scp-like URL → skip credential lookup
      }
      return lib.testRemoteAccess({
        url: body.url,
        ...(credential ? { credential } : {}),
      });
    }),
});
