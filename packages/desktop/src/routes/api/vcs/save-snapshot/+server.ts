import { basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { getVcsHooks, type VcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface SnapshotEntry {
  id: string;
  message: string;
  timestamp: number;
  author?: string;
}

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    snapshot: (opts: {
      projectDir: string;
      message: string;
      logFile?: string;
      authorName?: string;
      authorEmail?: string;
    }) => Promise<SnapshotEntry>;
  };
}

export const POST: RequestHandler = defineRoute<
  { projectDir: string; message: string },
  VcsHooks<LibModule>
>({
  hooks: () => getVcsHooks<LibModule>(),
  hooksUnavailableMessage: 'VCS hooks not registered',
  validate: async (raw) => {
    const body = raw as { projectDir?: string; message?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/save-snapshot');
    const message = typeof body.message === 'string' && body.message.trim()
      ? body.message.trim()
      : 'Saved snapshot';
    return { projectDir, message };
  },
  call: async ({ body, hooks }) => {
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(body.projectDir);
    // The log identifies the REPO, not the opened book: a snapshot commits the
    // whole repository, so a monorepo's books share one log file (matching the
    // lib's own buildRecoveryContext, which slugs the repo dir).
    const repoRoot =
      (source as { type?: string; repoRoot?: string })?.type === 'local-git-folder'
        ? ((source as { repoRoot?: string }).repoRoot ?? body.projectDir)
        : body.projectDir;
    return lib.providerFor(source).snapshot({
      projectDir: body.projectDir,
      message: body.message,
      ...(await gitIdentityArgs()),
      logFile: hooks.operationLogPath(basename(repoRoot)),
    });
  },
  onError: (e) => friendlyVcsError(e, 'saveSnapshot', 'vcs/save-snapshot'),
});
