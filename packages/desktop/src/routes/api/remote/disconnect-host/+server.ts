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
      // Delete the local credential FIRST (#221 C5) — "Remove this key" must
      // resolve immediately, even offline. This is the generic "remove any
      // stored connection" path Settings → Connections uses for publish
      // credentials too (bare `gdrive` or a named `gdrive#<account>` key), so
      // it needs the same best-effort Google revoke the provider-specific
      // publish:disconnect route has — but that revoke's ~10s network
      // timeout must never block the response, and its result is never read,
      // so it fires in the BACKGROUND after the local delete instead.
      // revokeGoogleCredential is designed to never throw, so firing it
      // un-awaited is safe; its own errors are still swallowed/logged exactly
      // as before. `loadLib()` (#221 C6) only runs for a google-oauth
      // credential — github.com/generic-forge disconnects never pay for it.
      const existing = await hooks.tokenStore.get(body.host);
      await hooks.tokenStore.delete(body.host);
      if (existing?.kind === 'google-oauth') {
        const lib = await hooks.loadLib();
        if (lib.revokeGoogleCredential) void lib.revokeGoogleCredential(existing.token);
      }
      return { ok: true };
    }),
});
