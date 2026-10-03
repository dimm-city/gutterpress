import { basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; message: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/save-snapshot');
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Saved snapshot';
    return { projectDir, message };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const source = await lib.detectProjectSource(body.projectDir);
    // The log identifies the REPO, not the opened book: a snapshot commits the
    // whole repository, so a monorepo's books share one log file (matching the
    // lib's own buildRecoveryContext, which slugs the repo dir).
    const repoRoot = lib.repoRootForSource(source, body.projectDir);
    return lib.providerFor(source).snapshot({
      projectDir: body.projectDir,
      message: body.message,
      ...(await gitIdentityArgs()),
      logFile: getHostServices().vcs.operationLogPath(basename(repoRoot)),
    });
  },
  onError: (e) => friendlyVcsError(e, 'saveSnapshot', 'vcs/save-snapshot'),
});
