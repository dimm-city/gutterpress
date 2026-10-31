import { error } from '@sveltejs/kit';
import { gitIdentityArgs } from '#lib/server/settings.ts';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Start a new revision from what the book is now and open it (#448). Unsaved
 * work is saved as a version first. It goes online with the next backup. The
 * name is checked by the lib, which answers in plain words (blank, unusable or
 * taken names).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; name: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; name?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/create-revision');
    if (typeof body.name !== 'string') error(400, 'vcs/create-revision requires a name');
    return { projectDir, name: body.name };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const vcs = getHostServices().vcs;
    // The version it saves and the new open revision must not race the host timers (see switch-branch).
    vcs.pauseTimers?.(body.projectDir);
    try {
      const result = await lib.createRevision({
        projectDir: body.projectDir,
        name: body.name,
        ...(await gitIdentityArgs()),
      });
      vcs.refreshOnlineStatus?.(body.projectDir);
      return result;
    } finally {
      vcs.resumeTimers?.(body.projectDir);
    }
  },
  onError: (e) => friendlyVcsError(e, 'vcs/create-revision'),
});
