import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * "Keep files as they are" for a switch that could not be put right: a copy of
 * the files is kept (if this switch has none yet) and the unfinished-switch
 * record is cleared, so the book can be built and saved again.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/keep-unfinished-switch'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.keepUnfinishedSwitchAsIs(body.projectDir);
    return { kept: true };
  },
  onError: (e) => friendlyVcsError(e, 'vcs/keep-unfinished-switch'),
});
