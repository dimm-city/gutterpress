import { handlePublishErrors, resolveDestinationProvider } from '../../_hooks';
import { defineRoute, requireProjectDir } from '../../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Existing places a provider can publish into (#221, gdrive: app-visible
 * Drive folders) — provider-neutral by design (precedent: `publish/list`'s
 * `listProducts`), so a future Dropbox/OneDrive provider needs no new route.
 * The wizard renders a picker only when `PublishProviderCard.destinations`
 * is present (`publish/list` threads that flag from `info.destinations`).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; providerId?: string }>({
  // In `validate`, not `call` — see publish/run's note on handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; providerId?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:destinations:list'),
      ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:destinations:list', async () => {
      if (!body.providerId) {
        throw new Error('publish:destinations:list requires { providerId }');
      }
      const { provider, req } = await resolveDestinationProvider(
        body.projectDir,
        body.providerId,
        'listDestinations',
      );
      return provider.listDestinations!(req);
    }),
});
