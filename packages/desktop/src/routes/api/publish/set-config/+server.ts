import { handlePublishErrors, publishDeps } from '../_hooks';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Save a provider's NON-SECRET settings (empty string values clear the key),
 * each where it belongs. The team decides where the book is published, so the
 * destinations ticked (`enabled`) and each one's settings go in the manifest's
 * `publish.<key>` section; only what is one person's own (which saved account
 * the book publishes with, an output folder outside the book) goes in their
 * private settings and is moved out of the manifest. The caller does not
 * choose — see the lib's `savePublishSettings`. Secrets never travel here —
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
      // Validates the id against the book's destinations (built-ins, then its
      // publishing plugins — experimental, #381); the manifest key IS the id.
      // Listing never restores or imports, which a settings write must not do.
      const known = await lib.listBookPublishProviders({ projectDir: body.projectDir });
      const provider = known.find((p) => p.id === body.providerId);
      if (!provider) {
        throw new Error(
          `Unknown publish provider "${body.providerId}". Available: ${known.map((p) => p.id).join(', ')}.`,
        );
      }
      // Only plain string/number/boolean values may reach the manifest writer.
      const values: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body.values)) {
        if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') values[k] = v;
      }
      return lib.savePublishSettings(body.projectDir, provider.id, values, (await publishDeps()).selections);
    }),
});
