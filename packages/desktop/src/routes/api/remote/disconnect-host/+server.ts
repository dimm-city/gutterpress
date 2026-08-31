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
      // Best-effort revoke at Google BEFORE deleting locally (#221 D4/D6) —
      // this is the generic "remove any stored connection" path Settings →
      // Connections uses for publish credentials too (bare `gdrive` or a
      // named `gdrive#<account>` key), so it needs the same revoke the
      // provider-specific publish:disconnect route has. Never blocks the
      // local delete, and never logs the token value.
      const existing = await hooks.tokenStore.get(body.host);
      const lib = await hooks.loadLib();
      if (existing?.kind === 'google-oauth' && lib.revokeGoogleCredential) {
        await lib.revokeGoogleCredential(existing.token);
      }
      await hooks.tokenStore.delete(body.host);
      return { ok: true };
    }),
});
