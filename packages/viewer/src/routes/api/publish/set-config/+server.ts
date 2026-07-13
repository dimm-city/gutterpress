import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Write a provider's NON-SECRET settings into the manifest's `publish.<key>`
 * section (empty string values delete the key). Secrets never travel here —
 * they go through publish:connect into the credential store.
 */
export const POST: RequestHandler = defineRoute<
  {
    projectDir?: string;
    providerId?: string;
    values?: Record<string, unknown>;
  },
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  call: async ({ body, hooks }) =>
    handlePublishErrors('publish:setConfig', async () => {
      const projectDir = requireAbsolute(body.projectDir, 'publish:setConfig');
      if (!body.providerId || !body.values || typeof body.values !== 'object') {
        throw new Error('publish:setConfig requires { providerId, values }');
      }
      const lib = await hooks.loadLib();
      if (!lib.setPublishProviderConfig || !lib.publishProviderFor) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      // Validates the id (throws on unknown); the manifest key IS the id.
      const provider = lib.publishProviderFor(body.providerId);
      // Only plain string/number values may reach the manifest writer.
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.values)) {
        if (v === null || typeof v === 'string' || typeof v === 'number') values[k] = v;
      }
      return lib.setPublishProviderConfig(projectDir, provider.info.id, values);
    }),
});
