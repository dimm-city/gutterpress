import { json, error } from '@sveltejs/kit';
import { isAbsolute, basename } from 'node:path';
import { gitIdentityArgs } from '$lib/server/settings';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import type { RequestHandler } from './$types';

interface SnapshotEntry {
  id: string;
  message: string;
  timestamp: number;
  author?: string;
}

interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    snapshot: (opts: { projectDir: string; message: string; logFile?: string; authorName?: string; authorEmail?: string }) => Promise<SnapshotEntry>;
  };
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({})) as { projectDir?: unknown; message?: unknown };
  const projectDir = body.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) {
    return error(400, 'vcs/save-snapshot requires an absolute projectDir');
  }
  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : 'Saved snapshot';

  try {
    const hooks = getVcsHooks<LibModule>();
    if (!hooks) return error(503, 'VCS hooks not registered');
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(projectDir);
    return json(
      await lib.providerFor(source).snapshot({
        projectDir,
        message,
        ...(await gitIdentityArgs()),
        logFile: hooks.operationLogPath(basename(projectDir)),
      }),
    );
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    const { status, message } = friendlyVcsError(e, 'saveSnapshot', 'vcs/save-snapshot');
    throw error(status, message);
  }
};
