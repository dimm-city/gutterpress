import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { url?: string };
    return json(
      await handleRemoteErrors('remote:testRemoteAccess', async () => {
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
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
