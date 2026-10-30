import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Delete a revision that is not open (#448). By default only on this computer;
 * `everywhere` also removes it from the online copy; one that is only in the
 * online copy is deleted from there. When it holds versions
 * found in no other revision, nothing is deleted and the result says how many
 * (`versionsOnlyHere`): the caller asks again, then calls with `discard: true`.
 */
export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  name: string;
  everywhere: boolean;
  discard: boolean;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; name?: unknown; everywhere?: unknown; discard?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/delete-revision');
    if (typeof body.name !== 'string' || !body.name.trim()) error(400, 'vcs/delete-revision requires a name');
    return {
      projectDir,
      name: body.name,
      everywhere: body.everywhere === true,
      discard: body.discard === true,
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.deleteRevision({
      projectDir: body.projectDir,
      name: body.name,
      everywhere: body.everywhere,
      discard: body.discard,
      tokenStore: getHostServices().remote.tokenStore,
    });
  },
  onError: (e) => friendlyVcsError(e, 'vcs/delete-revision'),
});
