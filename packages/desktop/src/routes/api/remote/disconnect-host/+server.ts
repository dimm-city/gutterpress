import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ host?: string }>({
  call: async ({ body }) =>
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
      const { tokenStore } = getHostServices().remote;
      const existing = await tokenStore.get(body.host);
      if (existing?.kind === 'google-oauth') {
        const lib = await loadLib();
        await lib.disconnectPublishCredential(body.host, { tokenStore });
      } else {
        await tokenStore.delete(body.host);
      }
      return { ok: true };
    }),
});
