import { handlePublishErrors } from '../_hooks';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Write a provider's NON-SECRET settings into the manifest's `publish.<key>`
 * section (empty string values delete the key). Secrets never travel here —
 * they go through publish:connect into the credential store.
 */
export const POST: RequestHandler = defineRoute<{
    projectDir: string;
    providerId?: string;
    values?: Record<string, unknown>;
  }>({
  // In `validate`, not `call` — see publish/run's note on handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; providerId?: unknown; values?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:setConfig'),
      ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
      ...(body.values && typeof body.values === 'object'
        ? { values: body.values as Record<string, unknown> }
        : {}),
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:setConfig', async () => {
      if (!body.providerId || !body.values || typeof body.values !== 'object') {
        throw new Error('publish:setConfig requires { providerId, values }');
      }
      const lib = await loadLib();
      // Validates the id (throws on unknown); the manifest key IS the id.
      const provider = lib.publishProviderFor(body.providerId);
      // Only plain string/number values may reach the manifest writer.
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.values)) {
        if (v === null || typeof v === 'string' || typeof v === 'number') values[k] = v;
      }
      return lib.setPublishProviderConfig(body.projectDir, provider.info.id, values);
    }),
});
