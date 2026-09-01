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
      // Delete the local credential FIRST (#221 C5) — the "Remove this key"
      // button must resolve immediately, even offline. The best-effort Google
      // revoke carries its own ~10s network timeout and its result is never
      // read, so it runs in the BACKGROUND after the response is decided
      // instead of blocking it. revokeGoogleCredential is designed to never
      // throw, so firing it un-awaited here is safe; its own errors are still
      // swallowed/logged exactly as before. Mirrors the CLI's `--disconnect`
      // branch (commands/publish.ts) for the local-delete step; the CLI has
      // no button to keep responsive, so it can afford to await the revoke.
      const existing = await hooks.tokenStore.get(key);
      await hooks.tokenStore.delete(key);
      if (existing?.kind === 'google-oauth' && lib.revokeGoogleCredential) {
        void lib.revokeGoogleCredential(existing.token);
      }
      return { ok: true };
    }),
});
