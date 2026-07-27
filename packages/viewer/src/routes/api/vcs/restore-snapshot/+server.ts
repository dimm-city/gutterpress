import { error } from '@sveltejs/kit';
import { gitIdentityArgs } from '$lib/server/settings';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; id: string }>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; id?: unknown };
    const projectDir = requireAbsolute(body.projectDir, 'vcs/restore-snapshot');
    // Snapshot ids are full commit SHAs — reject anything else before it
    // reaches the lib (a partial/garbage ref must never hit checkout).
    const id = body.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{40}$/i.test(id)) {
      error(400, 'vcs/restore-snapshot requires a valid snapshot id');
    }
    return { projectDir, id };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    // Safety contract (#13 / ADR 0006 §D5): the lib snapshots the current
    // state before restoring, so a restore can never lose author work. That
    // backup is a commit like any other — attribute it to the author.
    return lib.restoreVersionWithBackup({
      projectDir: body.projectDir,
      id: body.id,
      ...(await gitIdentityArgs()),
    });
  },
  onError: (e) => friendlyVcsError(e, 'restoreSnapshot', 'vcs/restore-snapshot'),
});
