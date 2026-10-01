import { basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { getHooks, handleRemoteErrors, type LibModule, type RemoteHooks, type TokenStore } from '../_hooks';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Repair online backup" (lib remote-auth/repair.ts): one fixed sequence that
// replaces a book's broken `.git` with a fresh download of its online history,
// keeps every file on this computer, restores files that exist only online,
// then saves a version and backs up. The old `.git` is moved (never deleted)
// to a per-repair folder under userData (`repairBackupDir`).

interface RepairLib extends LibModule {
  repairOnlineBackup?(args: {
    projectDir: string;
    backupDir: string;
    logFile: string;
    tokenStore: TokenStore;
    authorName?: string;
    authorEmail?: string;
  }): Promise<{ outcome: unknown; movedGitTo: string; restoredFiles: string[] }>;
  repoDirFor?(projectDir: string): Promise<string>;
}

export const POST: RequestHandler = defineRoute<{ projectDir: string }, RemoteHooks<RepairLib, TokenStore>>({
  hooks: () => getHooks<RepairLib, TokenStore>(),
  hooksUnavailableMessage: 'Remote hooks not available',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'remote:repair'),
  }),
  call: async ({ body, hooks }) =>
    handleRemoteErrors('remote:repair', async () => {
      const lib = await hooks.loadLib();
      const vcs = getVcsHooks();
      if (!lib.repairOnlineBackup || !lib.repoDirFor || !vcs?.repairBackupDir) {
        throw new Error('Repair is not available in this version of the lib');
      }
      const slug = basename(await lib.repoDirFor(body.projectDir));
      const identity = await gitIdentityArgs();
      const { outcome, restoredFiles } = await lib.repairOnlineBackup({
        projectDir: body.projectDir,
        backupDir: vcs.repairBackupDir(slug),
        logFile: vcs.operationLogPath(slug),
        tokenStore: hooks.tokenStore,
        authorName: identity.authorName,
        authorEmail: identity.authorEmail,
      });
      return { outcome, restoredFiles };
    }),
});
