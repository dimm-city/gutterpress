import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Version history's Pages (#408, #448): the host writes the version's files to a
 * scratch copy and renders it read-only through a second preview server;
 * the Version history screen shows the returned URL as the selected version's pages.
 * `null` when a later open or close replaced this one before it started.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; id?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/open-version-preview');
    const id = body.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{40}$/i.test(id)) {
      error(400, 'vcs/open-version-preview requires a valid snapshot id');
    }
    return { projectDir, id };
  },
  call: ({ body }) => getHostServices().vcs.openVersionPreview(body.projectDir, body.id),
  onError: (e) => friendlyVcsError(e, 'vcs/open-version-preview'),
});
