import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Has the open book's branch moved online since this copy last heard from it?
 * Reads the server's refs only (nothing downloaded or changed) and never
 * throws; it reports why it could not tell. Works with automatic online
 * backup off: that is when the app polls it.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string } | null)?.projectDir, 'remote:checkUpdates'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.checkRemoteUpdates({
      projectDir: body.projectDir,
      tokenStore: getHostServices().remote.tokenStore,
    });
  },
});
