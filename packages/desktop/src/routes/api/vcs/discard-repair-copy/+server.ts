import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Delete a kept repair copy (#508). Needs `confirm: true`; a copy whose files
 * are saved nowhere else also needs `discardUnsaved: true`.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string; unsaved: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown; confirm?: unknown; discardUnsaved?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/discard-repair-copy');
    if (typeof body.id !== 'string' || !/^\d{8,20}$/.test(body.id)) {
      error(400, 'vcs/discard-repair-copy requires a valid repair copy id');
    }
    // A delete is never a side effect of a stray call: it has to say so.
    if (body.confirm !== true) error(400, 'vcs/discard-repair-copy requires confirm: true');
    return { projectDir, id: body.id, unsaved: body.discardUnsaved === true };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.discardRepairCopy(body.projectDir, body.id, { unsaved: body.unsaved });
    return { discarded: true };
  },
  onError: (e) => friendlyVcsError(e, 'vcs/discard-repair-copy'),
});
