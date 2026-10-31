import { handlePublishErrors, resolveDestinationProvider } from '../../_hooks';
import { defineRoute, requireProjectDir } from '../../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Where this person publishes among a provider's destinations, and whether
 * they must choose one (#452, gdrive: the book's folder, their own, or "out of
 * reach"). Provider-neutral, same rationale as destinations/list. The lib
 * checks reachability with the account the book publishes with, and drops a
 * private folder that no longer applies; it never writes the manifest.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; providerId?: string }>({
  // In `validate`, not `call` — see publish/run's note on handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; providerId?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:destinations:status'),
      ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:destinations:status', async () => {
      if (!body.providerId) {
        throw new Error('publish:destinations:status requires { providerId }');
      }
      const { provider, req } = await resolveDestinationProvider(
        body.projectDir,
        body.providerId,
        'destinationStatus',
      );
      return provider.destinationStatus!(req);
    }),
});
