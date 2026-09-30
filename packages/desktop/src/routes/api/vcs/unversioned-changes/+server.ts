import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// "Saved, but not in a version yet": how many files changed since the book's
// last version. The save-status dialog reads it to reconcile "your edits are
// saved" with "your last version is days old". Read-only — the lib walks the
// working tree against the index with isomorphic-git (no system git, §7) and
// never touches history. Counts the OPEN BOOK's folder only (a book inside a
// larger repo ignores its siblings) and skips app-written plugin files.
// `changedFiles` is null for a plain folder (no version history to compare
// against); `stale` means a crashed version attempt may have left staged work.

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'vcs/unversioned-changes'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    const found = await lib.countUnversionedChanges(body.projectDir);
    return { changedFiles: found ? found.changedFiles : null, stale: found ? found.stale : false };
  },
  onError: (e) => friendlyVcsError(e, 'unversionedChanges', 'vcs/unversioned-changes'),
});
