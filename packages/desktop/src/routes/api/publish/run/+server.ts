import path from 'node:path';
import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute, requireContainedOrPicked, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Run a publish (or a --dry-run preflight). Returns the lib's structured
 * RunPublishResult plus the progress lines captured during the run, so the
 * panel can show the butler/swa log. Long-running by design — the client
 * awaits the response (same model as remote:sync).
 *
 * `artifactPath` is the UPLOAD SOURCE (2026-07-29 audit, Theme 1) —
 * `lib.runPublish` uploads it with the author's stored credential, so an
 * unchecked value is a local-file-to-network exfiltration primitive, not just
 * an out-of-project read. It can't be confined to the project either: a desktop
 * PDF export lands wherever the author chose in the Save dialog, and publishing
 * that is the common case. So it goes through `requireContainedOrPicked` (the
 * shared in-project-OR-dialog-picked check). Resolution matches the lib's own
 * (`run-publish.ts` does `path.resolve(projectDir, artifactPath)`), so a
 * relative artifact stays project-relative and can't `../` out.
 */
export const POST: RequestHandler = defineRoute<
  {
    projectDir: string;
    providerId?: string;
    artifactPath?: string;
    dryRun?: boolean;
  },
  NonNullable<ReturnType<typeof getHooks>>
>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Publish hooks not available',
  // The path checks live HERE, not inside `call`: `handlePublishErrors` maps
  // any non-`Error` throwable to a generic 500, and a SvelteKit `HttpError` is
  // a plain object — so a 403/400 raised inside `call` would reach the client
  // as "Publishing could not be completed."
  validate: async (raw) => {
    const body = raw as {
      projectDir?: unknown;
      providerId?: unknown;
      artifactPath?: unknown;
      dryRun?: unknown;
    };
    const projectDir = await requireProjectDir(body.projectDir, 'publish:run');
    return {
      projectDir,
      ...(typeof body.providerId === 'string' ? { providerId: body.providerId } : {}),
      ...(typeof body.artifactPath === 'string' && body.artifactPath
        ? {
            artifactPath: await requireContainedOrPicked(
              path.resolve(projectDir, body.artifactPath),
              'publish:run',
            ),
          }
        : {}),
      ...(body.dryRun ? { dryRun: true } : {}),
    };
  },
  call: async ({ body, hooks }) =>
    handlePublishErrors('publish:run', async () => {
      if (!body.providerId) throw new Error('publish:run requires { providerId }');
      const lib = await hooks.loadLib();
      if (!lib.runPublish) {
        throw new Error('Publishing is not available in this version of the lib');
      }
      const log: string[] = [];
      const result = await lib.runPublish(
        {
          projectDir: body.projectDir,
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
