import { error } from '@sveltejs/kit';
import path from 'node:path';
import { getHooks, handlePublishErrors } from '../_hooks';
import { defineRoute, requireProjectDir, requireWithinProjectRoot } from '../../_lib/route';
import { getPickedFilesHooks } from '../../../../../electron/server-bridge/picked-files';
import type { RequestHandler } from './$types';

/**
 * Run a publish (or a --dry-run preflight). Returns the lib's structured
 * RunPublishResult plus the progress lines captured during the run, so the
 * panel can show the butler/swa log. Long-running by design — the client
 * awaits the response (same model as remote:sync).
 */

/**
 * Authorize the UPLOAD SOURCE (2026-07-29 audit, Theme 1). `artifactPath` is
 * handed to `lib.runPublish`, which uploads that file to the configured
 * provider using the author's stored credential — so an unchecked
 * renderer-supplied value is a local-file-to-network exfiltration primitive,
 * not just an out-of-project read.
 *
 * It can't simply be confined to the project: a desktop PDF export goes
 * wherever the author chose in the Save dialog, and publishing that file is
 * the documented common case. So this mirrors the `src` policy that
 * `media:importImage`/`fs:copyFile` already use — inside the project is fine;
 * anything outside must be a path a NATIVE picker actually returned
 * (`dialog/pick-pdf-file` / `dialog/open-directory` register their results —
 * see `electron/server-bridge/picked-files.ts`).
 *
 * Resolution matches the lib's own (`run-publish.ts` does
 * `path.resolve(projectDir, artifactPath)`), so a relative artifact is
 * project-relative — and cannot `../` its way out, because the resolved path
 * is what gets checked.
 *
 * The picked-path capability is consumed and immediately RE-REGISTERED: the
 * wizard's "Check readiness" (dryRun) and the real publish are two calls with
 * the same artifact, so a strictly one-time consume would reject the second.
 * Re-registering keeps the property that actually matters — only a path this
 * process's own dialog produced is usable, never one a script invented — while
 * letting the author publish the file they picked more than once.
 */
async function requireAuthorizedArtifact(
  artifactPath: string,
  projectDir: string,
): Promise<string> {
  const resolved = path.resolve(projectDir, artifactPath);
  try {
    return await requireWithinProjectRoot(resolved, 'publish:run');
  } catch {
    const picked = getPickedFilesHooks();
    if (picked?.consume(resolved)) {
      picked.register([resolved]);
      return artifactPath;
    }
    error(403, 'publish:run: artifactPath is outside the open project and was not chosen from a file dialog');
  }
}
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
        ? { artifactPath: await requireAuthorizedArtifact(body.artifactPath, projectDir) }
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
