import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Saved, but not in a version yet": how many files changed since the book's
// last version. The save-status dialog reads it to reconcile "your edits are
// saved" with "your last version is days old". Read-only — the lib walks the
// working tree against the index with isomorphic-git (no system git, §7) and
// never touches history. `changedFiles` is null for a plain folder (no version
// history to compare against).

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/unversioned-changes'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return { changedFiles: await lib.countUnversionedChanges(body.projectDir) };
  },
  onError: (e) => friendlyVcsError(e, 'unversionedChanges', 'vcs/unversioned-changes'),
});
