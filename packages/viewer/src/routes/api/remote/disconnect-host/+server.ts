import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async ({ request }) => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    const body = await request.json().catch(() => ({})) as { host?: string };
    return json(
      await handleRemoteErrors('remote:disconnectHost', async () => {
        if (typeof body?.host !== 'string' || !body.host.trim()) {
          throw new Error('remote:disconnectHost requires a host');
        }
        await hooks.tokenStore.delete(body.host);
        return { ok: true };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
