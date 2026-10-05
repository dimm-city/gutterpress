import { basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Repair online backup" (lib remote-auth/repair.ts): replace a book's broken
// `.git` with a fresh download of its online history, keep every file on this
// computer, bring back files that exist only online, then save a version and
// back up. The old `.git` is moved (never deleted) to a per-repair folder
// under userData (`repairBackupDir`).

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'remote:repair'),
  }),
  call: async ({ body }) =>
    handleRemoteErrors('remote:repair', async () => {
      const lib = await loadLib();
      const vcs = getHostServices().vcs;
      // The same slug every other sync/version log of this repo uses.
      const slug = basename(lib.repoRootForSource(await lib.detectProjectSource(body.projectDir), body.projectDir));
      const identity = await gitIdentityArgs();
      return lib.repairOnlineBackup({
        projectDir: body.projectDir,
        backupDir: vcs.repairBackupDir(slug),
        logFile: vcs.operationLogPath(slug),
        tokenStore: getHostServices().remote.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
      });
    }),
});
