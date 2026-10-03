import { basename } from 'node:path';
import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Scorched earth" (lib remote-auth/scorched-earth.ts): back up the whole
// folder, empty it, download a fresh copy, copy the backed-up files back on
// top. The backup goes to a per-run folder under userData (`repairBackupDir`)
// and is never deleted.

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'remote:scorched-earth'),
  }),
  call: async ({ body }) =>
    handleRemoteErrors('remote:scorched-earth', async () => {
      const lib = await loadLib();
      const vcs = getHostServices().vcs;
      const slug = basename(lib.repoRootForSource(await lib.detectProjectSource(body.projectDir), body.projectDir));
      return lib.scorchedEarth({
        projectDir: body.projectDir,
        backupDir: vcs.repairBackupDir(slug),
        logFile: vcs.operationLogPath(slug),
        tokenStore: getHostServices().remote.tokenStore,
      });
    }),
});
