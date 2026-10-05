import { handlePublishErrors, resolveDestinationProvider } from '../../_hooks';
import { defineRoute, requireProjectDir } from '../../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Create a new destination (#221 D9, gdrive: a Drive folder at My Drive
 * root). Provider-neutral, same rationale as destinations/list — see that
 * route's header.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; providerId?: string; name?: string }>({
  // In `validate`, not `call` — see publish/run's note on handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; providerId?: unknown; name?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:destinations:create'),
      ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:destinations:create', async () => {
      if (!body.providerId || typeof body.name !== 'string' || !body.name.trim()) {
        throw new Error('publish:destinations:create requires { providerId, name }');
      }
      const { provider, req } = await resolveDestinationProvider(
        body.projectDir,
        body.providerId,
        'createDestination',
      );
      return provider.createDestination!(req, body.name.trim());
    }),
});
