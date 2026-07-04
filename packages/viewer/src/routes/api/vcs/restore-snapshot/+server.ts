import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface RestoreVersionResult {
  restoredId: string;
  backupId?: string;
}

interface LibModule {
  restoreVersionWithBackup: (opts: { projectDir: string; id: string }) => Promise<RestoreVersionResult>;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({})) as { projectDir?: unknown; id?: unknown };
  const projectDir = body.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) {
    return error(400, 'vcs/restore-snapshot requires an absolute projectDir');
  }

  // Snapshot ids are full commit SHAs — reject anything else before it
  // reaches the lib (a partial/garbage ref must never hit checkout).
  const id = body.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{40}$/i.test(id)) {
    return error(400, 'vcs/restore-snapshot requires a valid snapshot id');
  }

  try {
    const hooks = getVcsHooks<LibModule>();
    if (!hooks) return error(503, 'VCS hooks not registered');
    const lib = await hooks.loadLib();
    // Safety contract (#13 / ADR 0006 §D5): the lib snapshots the current
    // state before restoring, so a restore can never lose author work.
    return json(await lib.restoreVersionWithBackup({ projectDir, id }));
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    const { status, message } = friendlyVcsError(e, 'restoreSnapshot', 'vcs/restore-snapshot');
    throw error(status, message);
  }
};
