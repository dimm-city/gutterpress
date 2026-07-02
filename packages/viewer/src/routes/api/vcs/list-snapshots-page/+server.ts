import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';

// Local types — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface SnapshotEntry {
  id: string;
  message: string;
  timestamp: number;
  author?: string;
}

interface SnapshotPage {
  entries: SnapshotEntry[];
  hasMore: boolean;
}

interface LibModule {
  detectProjectSource: (dir: string) => Promise<unknown>;
  providerFor: (source: unknown) => {
    listHistoryPage: (dir: string, opts?: { limit?: number; before?: string }) => Promise<SnapshotPage>;
  };
}

const VCS_FRIENDLY_ERROR =
  /no changes since the last snapshot|no version history yet|your work is safe|project files were not changed|requires an absolute project path|valid snapshot id|already inside a versioned project/i;

function friendlyError(e: unknown, op: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[vcs/list-snapshots-page] failed: ${msg}`);
  if (e instanceof Error && (e as Error & { stack?: string }).stack) {
    console.error((e as Error & { stack?: string }).stack);
  }
  if (VCS_FRIENDLY_ERROR.test(msg)) {
    throw error(422, msg);
  }
  throw error(500, `Version history could not complete the ${op} operation. See the app log for details.`);
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({})) as {
    projectDir?: unknown;
    limit?: unknown;
    before?: unknown;
  };
  const projectDir = body.projectDir;
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir)) {
    return error(400, 'vcs/list-snapshots-page requires an absolute projectDir');
  }

  // Validate the continuation cursor before it reaches the lib (it is
  // used as a git ref); a malformed cursor must never become a ref query.
  const before = body.before;
  if (before !== undefined && (typeof before !== 'string' || !/^[0-9a-f]{40}$/i.test(before))) {
    return error(400, 'vcs/list-snapshots-page requires a valid snapshot id cursor');
  }

  const limit = body.limit;

  try {
    const hooks = getVcsHooks<LibModule>();
    if (!hooks) return error(503, 'VCS hooks not registered');
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(projectDir);
    return json(
      await lib.providerFor(source).listHistoryPage(projectDir, {
        ...(typeof limit === 'number' ? { limit } : {}),
        ...(typeof before === 'string' ? { before } : {}),
      }),
    );
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    friendlyError(e, 'listSnapshotsPage');
  }
};
