import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/**
 * Store an API key for a publish provider, verifying it with the platform
 * BEFORE declaring success (a bad paste is deleted again and reported).
 * Response is redacted — never includes the token.
 */
export const POST: RequestHandler = jsonRoute(
  async (body: { projectDir?: string; providerId?: string; token?: string }) => {
    const hooks = getHooks();
    if (!hooks) error(503, 'Publish hooks not available');
    return handleRemoteErrors('publish:connect', async () => {
      const projectDir = requireAbsolute(body.projectDir, 'publish:connect');
      if (!body.providerId || typeof body.token !== 'string' || !body.token.trim()) {
        throw new Error('publish:connect requires { providerId, token }');
      }
      const lib = await hooks.loadLib();
      if (!lib.publishProviderFor || !lib.resolvePublishRequest) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      const provider = lib.publishProviderFor(body.providerId);
      if (!provider.info.credential.required) {
        throw new Error(`${provider.info.label} needs no API key — just publish.`);
      }
      const host = provider.info.credential.host;
      await hooks.tokenStore.set(host, {
        host,
        kind: 'token',
        token: body.token.trim(),
        label: provider.info.label,
        createdAt: Date.now(),
      });
      const req = await lib.resolvePublishRequest(
        { projectDir, providerId: provider.info.id },
        { tokenStore: hooks.tokenStore },
      );
      const auth = await provider.authenticate(req);
      if (!auth.ok) {
        await hooks.tokenStore.delete(host);
        throw new Error(auth.message ?? `${provider.info.label} didn't accept that key.`);
      }
      return { connected: true, providerId: provider.info.id };
    });
  },
);
