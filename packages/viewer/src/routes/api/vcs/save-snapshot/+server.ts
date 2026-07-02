import { json, error } from '@sveltejs/kit';
import { isAbsolute, basename } from 'node:path';
import type { RequestHandler } from './$types';
import { gitIdentityArgs } from '$lib/server/settings';

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

interface VcsHooks {
  loadLib: () => Promise<LibModule>;
  operationLogPath: (slug: string) => string;
}

const VCS_FRIENDLY_ERROR =
  /no changes since the last snapshot|no version history yet|your work is safe|project files were not changed|requires an absolute project path|valid snapshot id|already inside a versioned project/i;

function friendlyError(e: unknown, op: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[vcs/save-snapshot] failed: ${msg}`);
  if (e instanceof Error && (e as Error & { stack?: string }).stack) {
    console.error((e as Error & { stack?: string }).stack);
  }
  if (VCS_FRIENDLY_ERROR.test(msg)) {
    throw error(422, msg);
  }
  throw error(500, `Version history could not complete the ${op} operation. See the app log for details.`);
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
    const hooks = (globalThis as unknown as Record<string, VcsHooks>).__printMdVcsHooks__;
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
    friendlyError(e, 'saveSnapshot');
  }
};
