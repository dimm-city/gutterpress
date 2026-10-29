import { handleRemoteErrors } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Fetch every branch the project's remote has, so the revision list shows
 * revisions created somewhere else (#273). Reads the network but only ever
 * writes remote-tracking refs — no local branch, no working-tree change — so it
 * is safe to call with unsaved work open.
 *
 * Best-effort by contract: an older lib, no remote, no credential, or being
 * offline all resolve to `{ refreshed: false }`. The list then shows whatever
 * is already on disk rather than an error over a control the author never
 * explicitly asked to sync.
 *
 * @deprecated `vcs/list-revisions` with `refresh: true` does this; removed once
 * the desktop's callers have moved over.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string })?.projectDir, 'remote:refreshCopies'),
  }),
  call: async ({ body }) =>
    handleRemoteErrors('remote:refreshCopies', async () => {
      const lib = await loadLib();
      if (!lib.refreshRemoteCopies) return { refreshed: false };
      return lib.refreshRemoteCopies({ projectDir: body.projectDir, tokenStore: getHostServices().remote.tokenStore });
    }),
});
