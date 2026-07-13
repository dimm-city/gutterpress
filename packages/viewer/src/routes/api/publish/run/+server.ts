import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Run a publish (or a --dry-run preflight). Returns the lib's structured
 * RunPublishResult plus the progress lines captured during the run, so the
 * panel can show the butler/swa log. Long-running by design — the client
 * awaits the response (same model as remote:sync).
 */
export const POST: RequestHandler = defineRoute<
  {
    projectDir?: string;
    providerId?: string;
    artifactPath?: string;
    dryRun?: boolean;
  },
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  call: async ({ body, hooks }) =>
    handlePublishErrors('publish:run', async () => {
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
    }),
});
