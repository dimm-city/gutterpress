import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHooks, handleRemoteErrors } from '../_hooks';

export const POST: RequestHandler = async () => {
  const hooks = getHooks();
  if (!hooks) return error(503, 'Remote hooks not available');
  try {
    return json(
      await handleRemoteErrors('remote:disconnectGitHub', async () => {
        await hooks.tokenStore.delete(hooks.GITHUB_HOST);
        return { ok: true };
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
