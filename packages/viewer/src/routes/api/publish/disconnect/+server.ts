import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Forget the stored key for a publish provider. */
export const POST: RequestHandler = defineRoute<
  { providerId?: string },
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  call: async ({ body, hooks }) =>
    handlePublishErrors('publish:disconnect', async () => {
      if (!body.providerId) throw new Error('publish:disconnect requires { providerId }');
      const lib = await hooks.loadLib();
      if (!lib.publishProviderFor) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      const provider = lib.publishProviderFor(body.providerId);
      await hooks.tokenStore.delete(provider.info.credential.host);
      return { ok: true };
    }),
});
