import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Forget a stored key for a publish provider (the default, or a named account). */
export const POST: RequestHandler = defineRoute<
  { providerId?: string; account?: string },
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
      const host = provider.info.credential.host;
      // Delete the compound `<host>#<account>` key for a named account, else the
      // default (bare-host) entry.
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const key =
        account && lib.publishCredentialKey
          ? lib.publishCredentialKey(host, account)
          : host;
      await hooks.tokenStore.delete(key);
      return { ok: true };
    }),
});
