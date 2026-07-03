import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { host?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Remote hooks not available');
  return handleRemoteErrors('remote:disconnectHost', async () => {
    if (typeof body?.host !== 'string' || !body.host.trim()) {
      throw new Error('remote:disconnectHost requires a host');
    }
    await hooks.tokenStore.delete(body.host);
    return { ok: true };
  });
});
