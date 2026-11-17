import { basename } from 'node:path';
import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { gitIdentityArgs } from '#lib/server/settings.ts';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Manual sync of the open book with its online copy. `push: false` is "Get
 * latest": fetch and merge the online changes, never send anything back.
 * `bringInMainDraft` also combines the online Main draft into the open draft
 * ("Bring them in", #524). None of these depend on automatic online backup.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; message?: string; push: boolean; bringInMainDraft: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: string; push?: unknown; bringInMainDraft?: unknown };
    return {
      projectDir: await requireProjectDir(body?.projectDir, 'remote:sync'),
      message: body?.message,
      push: body?.push !== false,
      bringInMainDraft: body?.bringInMainDraft === true,
    };
  },
  call: async ({ body }) =>
    handleRemoteErrors('remote:sync', async () => {
      const lib = await loadLib();
      const identity = await gitIdentityArgs();
      // The repo's sync log, the one automatic passes write: without it a failed send left no trace.
      const repoRoot = lib.repoRootForSource(await lib.detectProjectSource(body.projectDir), body.projectDir);
      return lib.syncProject({
        projectDir: body.projectDir,
        tokenStore: getHostServices().remote.tokenStore,
        logFile: getHostServices().vcs.operationLogPath(basename(repoRoot)),
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
        push: body.push,
        ...(body.bringInMainDraft ? { bringInMainDraft: true } : {}),
        ...(typeof body.message === 'string' && body.message.trim()
          ? { message: body.message.trim() }
          : {}),
      });
    }),
});
