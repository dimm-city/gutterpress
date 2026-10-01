import { basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Repair online backup" (lib remote-auth/repair.ts): replace a book's broken
// `.git` with a fresh download of its online history, keep every file on this
// computer, bring back files that exist only online, then save a version and
// back up. The old `.git` is moved (never deleted) to a per-repair folder
// under userData (`repairBackupDir`).

export const POST: RequestHandler = defineRoute<{ projectDir: string }, RemoteHooks<LibModule, TokenStore>>({
  hooks: getHooks,
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'remote:repair'),
  }),
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:repair', async () => {
      const lib = await hooks.loadLib();
      const vcs = getVcsHooks();
      if (!lib.repairOnlineBackup || !lib.detectProjectSource || !lib.repoRootForSource || !vcs) {
        throw new Error('Repair is not available in this version of the lib');
      }
      // The same slug every other sync/version log of this repo uses.
      const slug = basename(lib.repoRootForSource(await lib.detectProjectSource(body.projectDir), body.projectDir));
      const identity = await gitIdentityArgs();
      return lib.repairOnlineBackup({
        projectDir: body.projectDir,
        backupDir: vcs.repairBackupDir(slug),
        logFile: vcs.operationLogPath(slug),
        tokenStore: hooks.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
      });
    }),
});
