import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { url?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:testRemoteAccess', async () => {
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      throw new Error('remote:testRemoteAccess requires a remote URL');
    }
    const lib = await hooks.loadLib();
    if (!lib.testRemoteAccess) {
      throw new Error('testRemoteAccess not available in this version of the lib');
    }
    // Use the stored credential for the remote's host, when one exists.
    // Credentials are keyed hostname[:port]; a self-hosted forge on a port
    // still resolves. SSH/scp-like URLs don't parse — lib classifies without auth.
    let credential: unknown = null;
    try {
      const u = new URL(body.url);
      const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
      credential = await hooks.tokenStore.get(host);
    } catch {
      // SSH/scp-like URL → skip credential lookup
    }
    return lib.testRemoteAccess({
      url: body.url,
      ...(credential ? { credential } : {}),
    });
  });
});
