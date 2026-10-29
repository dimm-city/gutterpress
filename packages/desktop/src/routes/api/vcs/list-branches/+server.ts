import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * @deprecated Use `vcs/list-revisions`; removed once the desktop's callers have moved over.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/list-branches'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    // `null` means the source has nothing to switch between (not a
    // `local-git-folder`) — the revision control hides on that, so this
    // passes it straight through rather than turning it into an error.
    return lib.listLocalBranches(body.projectDir);
  },
  onError: (e) => friendlyVcsError(e, 'vcs/list-branches'),
});
