import { error } from '@sveltejs/kit';
import { getHooks, handleRemoteErrors } from '../_hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/**
 * Write a provider's NON-SECRET settings into the manifest's `publish.<key>`
 * section (empty string values delete the key). Secrets never travel here —
 * they go through publish:connect into the credential store.
 */
export const POST: RequestHandler = jsonRoute(
  async (body: {
    projectDir?: string;
    providerId?: string;
    values?: Record<string, unknown>;
  }) => {
    const hooks = getHooks();
    if (!hooks) error(503, 'Publish hooks not available');
    return handleRemoteErrors('publish:setConfig', async () => {
      const projectDir = requireAbsolute(body.projectDir, 'publish:setConfig');
      if (!body.providerId || !body.values || typeof body.values !== 'object') {
        throw new Error('publish:setConfig requires { providerId, values }');
      }
      const lib = await hooks.loadLib();
      if (!lib.setPublishProviderConfig || !lib.manifestKeyFor) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      // Only plain string/number values may reach the manifest writer.
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.values)) {
        if (v === null || typeof v === 'string' || typeof v === 'number') values[k] = v;
      }
      return lib.setPublishProviderConfig(
        projectDir,
        lib.manifestKeyFor(body.providerId),
        values,
      );
    });
  },
);
