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
      // disconnectPublishCredential (shared with remote:disconnectHost, and
      // with the CLI's --disconnect via its own awaitRevoke:true) deletes the
      // local credential FIRST (#221 C5), THEN starts a best-effort revoke at
      // Google without awaiting it when the credential's kind supports one —
      // so awaiting the call here still returns as soon as the local delete
      // is done, exactly like the un-refactored code, while the revoke (its
      // own ~10s network timeout) keeps running in the background.
      if (lib.disconnectPublishCredential) {
        await lib.disconnectPublishCredential(key, { tokenStore: hooks.tokenStore });
      } else {
        // Fallback for an older lib that predates the shared helper — same
        // read/delete/revoke shape, just inlined.
        const existing = await hooks.tokenStore.get(key);
        await hooks.tokenStore.delete(key);
        if (existing?.kind === 'google-oauth' && lib.revokeGoogleCredential) {
          void lib.revokeGoogleCredential(existing.token);
        }
      }
      return { ok: true };
    }),
});
