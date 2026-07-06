import { error } from '@sveltejs/kit';
import { getHooks, handlePublishErrors } from '../_hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

/**
 * Run a publish (or a --dry-run preflight). Returns the lib's structured
 * RunPublishResult plus the progress lines captured during the run, so the
 * panel can show the butler/swa log. Long-running by design — the client
 * awaits the response (same model as remote:sync).
 */
export const POST: RequestHandler = jsonRoute(
  async (body: {
    projectDir?: string;
    providerId?: string;
    artifactPath?: string;
    dryRun?: boolean;
  }) => {
    const hooks = getHooks();
    if (!hooks) error(503, 'Publish hooks not available');
    return handlePublishErrors('publish:run', async () => {
      const projectDir = requireAbsolute(body.projectDir, 'publish:run');
      if (!body.providerId) throw new Error('publish:run requires { providerId }');
      const lib = await hooks.loadLib();
      if (!lib.runPublish) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      const log: string[] = [];
      const result = await lib.runPublish(
        {
          projectDir,
          providerId: body.providerId,
          ...(typeof body.artifactPath === 'string' && body.artifactPath
            ? { artifactPath: body.artifactPath }
            : {}),
          ...(body.dryRun ? { dryRun: true } : {}),
        },
        {
          tokenStore: hooks.tokenStore,
          onProgress: (line: string) => {
            log.push(line);
            if (log.length > 500) log.shift();
          },
        },
      );
      return { ...result, log };
    });
  },
);
