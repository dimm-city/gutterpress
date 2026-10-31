import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The book's revisions and where each is kept (#448); `null` for a plain
 * folder. `refresh` first asks the online copy which revisions it has. That is
 * best-effort: offline, signed out or no online copy just leaves the list as
 * this computer last knew it, and `checkedOnline` says whether the check
 * worked. Only remote-tracking refs are written, so it is safe with unsaved
 * work open.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; refresh: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; refresh?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'vcs/list-revisions'),
      refresh: body.refresh === true,
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const checkedOnline = body.refresh
      ? (await lib.refreshRemoteCopies({ projectDir: body.projectDir, tokenStore: getHostServices().remote.tokenStore })).refreshed
      : false;
    const list = await lib.listRevisions(body.projectDir);
    return list && { ...list, checkedOnline };
  },
  onError: (e) => friendlyVcsError(e, 'vcs/list-revisions'),
});
