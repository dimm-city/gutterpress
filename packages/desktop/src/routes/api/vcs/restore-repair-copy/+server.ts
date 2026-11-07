import { error } from '@sveltejs/kit';
import { gitIdentityArgs } from '#lib/server/settings.ts';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Put the files from a kept repair copy back (#508). The same safe restore as
 * a version: work not yet saved is saved as a version first.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/restore-repair-copy');
    if (typeof body.id !== 'string' || !/^\d{8,20}$/.test(body.id)) {
      error(400, 'vcs/restore-repair-copy requires a valid repair copy id');
    }
    return { projectDir, id: body.id };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const restored = await lib.restoreRepairCopy({
      projectDir: body.projectDir,
      id: body.id,
      ...(await gitIdentityArgs()),
    });
    if (restored.backupId) getHostServices().vcs.refreshOnlineStatus?.(body.projectDir);
    return restored;
  },
  onError: (e) => friendlyVcsError(e, 'vcs/restore-repair-copy'),
});
