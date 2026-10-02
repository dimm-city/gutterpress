import { basename } from 'node:path';
import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Scorched earth" (lib remote-auth/scorched-earth.ts): back up the whole
// folder, empty it, download a fresh copy, copy the backed-up files back on
// top. The backup goes to a per-run folder under userData (`repairBackupDir`)
// and is never deleted.

export const POST: RequestHandler = defineRoute<{ projectDir: string }, RemoteHooks<LibModule, TokenStore>>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'remote:scorched-earth'),
  }),
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:scorched-earth', async () => {
      const lib = await hooks.loadLib();
      const vcs = getVcsHooks();
      if (!lib.scorchedEarth || !lib.detectProjectSource || !lib.repoRootForSource || !vcs) {
        throw new Error('Scorched earth is not available in this version of the lib');
      }
      const slug = basename(lib.repoRootForSource(await lib.detectProjectSource(body.projectDir), body.projectDir));
      return lib.scorchedEarth({
        projectDir: body.projectDir,
        backupDir: vcs.repairBackupDir(slug),
        logFile: vcs.operationLogPath(slug),
        tokenStore: hooks.tokenStore,
      });
    }),
});
