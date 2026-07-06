import { error } from '@sveltejs/kit';
import { getHooks, handlePublishErrors } from '../_hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/** Forget the stored key for a publish provider. */
export const POST: RequestHandler = jsonRoute(async (body: { providerId?: string }) => {
  const hooks = getHooks();
  if (!hooks) error(503, 'Publish hooks not available');
  return handlePublishErrors('publish:disconnect', async () => {
    if (!body.providerId) throw new Error('publish:disconnect requires { providerId }');
    const lib = await hooks.loadLib();
    if (!lib.publishProviderFor) {
      throw new Error('Publishing is not available in this version of the lib');
    }
    const provider = lib.publishProviderFor(body.providerId);
    await hooks.tokenStore.delete(provider.info.credential.host);
    return { ok: true };
  });
});
