import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * What is online that this computer has not got (#408): fetches the book's
 * branch (refs only — nothing merged, nothing checked out) and describes
 * the versions above the merge base with the files each changed. Never
 * throws for the usual reasons; it reports why it could not tell.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string } | null)?.projectDir, 'vcs/online-versions'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listOnlineVersions({
      projectDir: body.projectDir,
      tokenStore: getHostServices().remote.tokenStore,
    });
  },
});
