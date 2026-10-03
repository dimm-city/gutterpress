import { handlePublishErrors } from '../_hooks';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Forget a stored key for a publish provider (the default, or a named account). */
export const POST: RequestHandler = defineRoute<{ providerId?: string; account?: string }>({
  call: async ({ body }) =>
    handlePublishErrors('publish:disconnect', async () => {
      if (!body.providerId) throw new Error('publish:disconnect requires { providerId }');
      const lib = await loadLib();
      const provider = lib.publishProviderFor(body.providerId);
      const host = provider.info.credential.host;
      // Delete the compound `<host>#<account>` key for a named account, else the
      // default (bare-host) entry.
      const account = typeof body.account === 'string' ? body.account.trim() : '';
      const key = account ? lib.publishCredentialKey(host, account) : host;
      // disconnectPublishCredential (shared with remote:disconnectHost, and
      // with the CLI's --disconnect via its own awaitRevoke:true) deletes the
      // local credential FIRST (#221 C5), THEN starts a best-effort revoke at
      // Google without awaiting it when the credential's kind supports one —
      // so awaiting the call here still returns as soon as the local delete
      // is done, exactly like the un-refactored code, while the revoke (its
      // own ~10s network timeout) keeps running in the background.
      await lib.disconnectPublishCredential(key, { tokenStore: getHostServices().remote.tokenStore });
      return { ok: true };
    }),
});
