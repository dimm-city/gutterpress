import { getVcsHooks, type VcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface LocalBranches {
  current: string | null;
  branches: string[];
  /** Subset of `branches` that has no local ref yet (created on switch). */
  remoteOnly: string[];
}

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  listLocalBranches: (dir: string) => Promise<LocalBranches | null>;
}

export const POST: RequestHandler = defineRoute<{ projectDir: string }, VcsHooks<LibModule>>({
  hooks: () => getVcsHooks<LibModule>(),
  hooksUnavailableMessage: 'VCS hooks not registered',
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/list-branches'),
  }),
  call: async ({ body, hooks }) => {
    const lib = await hooks.loadLib();
    // `null` means the source has nothing to switch between (not a
    // `local-git-folder`) — the Saving settings row hides on that, so this
    // passes it straight through rather than turning it into an error.
    return lib.listLocalBranches(body.projectDir);
  },
  onError: (e) => friendlyVcsError(e, 'listLocalBranches', 'vcs/list-branches'),
});
