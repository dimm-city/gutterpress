import { error } from '@sveltejs/kit';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  limit?: number;
  before?: string;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; limit?: unknown; before?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/list-snapshots-page');
    // Validate the continuation cursor before it reaches the lib (it is
    // used as a git ref); a malformed cursor must never become a ref query.
    const before = body.before;
    if (before !== undefined && (typeof before !== 'string' || !/^[0-9a-f]{40}$/i.test(before))) {
      error(400, 'vcs/list-snapshots-page requires a valid snapshot id cursor');
    }
    return {
      projectDir,
      ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
      ...(typeof before === 'string' ? { before } : {}),
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const source = await lib.detectProjectSource(body.projectDir);
    const page = await lib.providerFor(source).listHistoryPage(body.projectDir, {
      ...(typeof body.limit === 'number' ? { limit: body.limit } : {}),
      ...(typeof body.before === 'string' ? { before: body.before } : {}),
    });
    // Each version says whether it is backed up (#408); what it changed is
    // asked for one version at a time (vcs/version-changes). A plain folder
    // has no versions to describe.
    if (source.type !== 'local-git-folder') return page;
    return { ...page, entries: await lib.describeVersions(body.projectDir, page.entries) };
  },
  onError: (e) => friendlyVcsError(e, 'vcs/list-snapshots-page'),
});
