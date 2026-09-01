import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { host?: string },
  RemoteHooks<LibModule, TokenStore>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:disconnectHost', async () => {
      if (typeof body?.host !== 'string' || !body.host.trim()) {
        throw new Error('remote:disconnectHost requires a host');
      }
      // This is the generic "remove any stored connection" path Settings →
      // Connections uses for publish credentials too (bare `gdrive` or a
      // named `gdrive#<account>` key), so a google-oauth one needs the same
      // best-effort revoke-then-delete the provider-specific publish:disconnect
      // route has — disconnectPublishCredential is the shared implementation
      // for both. `loadLib()` (#221 C6) only runs for a google-oauth
      // credential — github.com/generic-forge disconnects (the common case
      // for this generic route) never pay for it, and go straight to a plain
      // local delete.
      const existing = await hooks.tokenStore.get(body.host);
      if (existing?.kind === 'google-oauth') {
        const lib = await hooks.loadLib();
        if (lib.disconnectPublishCredential) {
          await lib.disconnectPublishCredential(body.host, { tokenStore: hooks.tokenStore });
        } else {
          await hooks.tokenStore.delete(body.host);
          if (lib.revokeGoogleCredential) void lib.revokeGoogleCredential(existing.token);
        }
      } else {
        await hooks.tokenStore.delete(body.host);
      }
      return { ok: true };
    }),
});
