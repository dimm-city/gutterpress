import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * What is online that this computer has not got (#408): fetches the book's
 * branch (refs only — nothing merged, nothing checked out) and describes
 * each version this computer hasn't got with the files it changed (#484).
 * Never throws for the usual reasons; it reports why it could not tell.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; maxAgeMs: number }>({
  validate: async (raw) => {
    const body = (raw ?? {}) as { projectDir?: string; maxAgeMs?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'vcs/online-versions'),
      // Shares the revision list's online check when it is this recent; 0 forces a real one.
      maxAgeMs:
        typeof body.maxAgeMs === 'number' && Number.isFinite(body.maxAgeMs) && body.maxAgeMs >= 0
          ? Math.min(body.maxAgeMs, 10 * 60_000)
          : 20_000,
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listOnlineVersions({
      projectDir: body.projectDir,
      tokenStore: getHostServices().remote.tokenStore,
      maxAgeMs: body.maxAgeMs,
    });
  },
});
