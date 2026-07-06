import { error } from '@sveltejs/kit';
import { getHooks, handlePublishErrors } from '../_hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/**
 * Store an API key for a publish provider. The lib's connectPublishProvider
 * verifies the PASTED key with the platform BEFORE storing it — a rejected
 * paste (or a manifest error mid-verify) leaves any previously working
 * credential untouched. Response is redacted — never includes the token.
 */
export const POST: RequestHandler = jsonRoute(
  async (body: { projectDir?: string; providerId?: string; token?: string }) => {
    const hooks = getHooks();
    if (!hooks) error(503, 'Publish hooks not available');
    return handlePublishErrors('publish:connect', async () => {
      const projectDir = requireAbsolute(body.projectDir, 'publish:connect');
      if (!body.providerId || typeof body.token !== 'string' || !body.token.trim()) {
        throw new Error('publish:connect requires { providerId, token }');
      }
      const lib = await hooks.loadLib();
      if (!lib.connectPublishProvider) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      return lib.connectPublishProvider(
        { projectDir, providerId: body.providerId, token: body.token },
        { tokenStore: hooks.tokenStore },
      );
    });
  },
);
