import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Rename a revision (#448). One that is also in the online copy is renamed
 * there too, right away. Offline, a rejected sign-in, or an online copy ahead of
 * this computer changes nothing, and the lib says so in plain words.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; from: string; to: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; from?: unknown; to?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/rename-revision');
    if (typeof body.from !== 'string' || typeof body.to !== 'string') {
      error(400, 'vcs/rename-revision requires the current and the new name');
    }
    return { projectDir, from: body.from, to: body.to };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const vcs = getHostServices().vcs;
    // Renaming the open revision moves HEAD, and the online step takes a while: keep the host timers out.
    vcs.pauseTimers?.(body.projectDir);
    try {
      return await lib.renameRevision({
        projectDir: body.projectDir,
        from: body.from,
        to: body.to,
        tokenStore: getHostServices().remote.tokenStore,
      });
    } finally {
      vcs.resumeTimers?.(body.projectDir);
    }
  },
  onError: (e) => friendlyVcsError(e, 'vcs/rename-revision'),
});
