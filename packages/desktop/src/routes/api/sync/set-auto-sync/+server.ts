import { error } from '@sveltejs/kit';
import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// A route, not IPC: this is a pure settings write (no push stream, no
// live-BrowserWindow need). getHostServices().sync.setAutoSync
// (electron/main.ts) does the operation: persist versionHistory.autoSync, then re-arm or
// cancel the orchestrator's periodic timer for the open project.
export const POST: RequestHandler = defineRoute<{ enabled: boolean }>({
  validate: (raw) => {
    const body = raw as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      error(400, 'sync:setAutoSync requires a boolean');
    }
    return { enabled: body.enabled };
  },
  call: ({ body }) => getHostServices().sync.setAutoSync(body.enabled),
});
