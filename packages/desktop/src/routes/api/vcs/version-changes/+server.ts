import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The files one version changed, each with a plain hint (#408): Version
 * history's Changed files for the selected version. Asked per version, not
 * per history page, so listing versions stays cheap. Read-only.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/version-changes');
    const id = body.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{40}$/i.test(id)) {
      error(400, 'vcs/version-changes requires a valid snapshot id');
    }
    return { projectDir, id };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listVersionChanges(body.projectDir, body.id);
  },
  onError: (e) => friendlyVcsError(e, 'vcs/version-changes'),
});
