import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Delete a kept repair copy (#508). */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/discard-repair-copy');
    if (typeof body.id !== 'string' || !/^\d{8,20}$/.test(body.id)) {
      error(400, 'vcs/discard-repair-copy requires a valid repair copy id');
    }
    return { projectDir, id: body.id };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.discardRepairCopy(body.projectDir, body.id);
    return { discarded: true };
  },
  onError: (e) => friendlyVcsError(e, 'vcs/discard-repair-copy'),
});
