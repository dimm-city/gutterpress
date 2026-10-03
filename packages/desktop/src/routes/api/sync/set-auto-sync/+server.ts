import { error } from '@sveltejs/kit';
import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

// ARCH review #8: sync:setAutoSync was IPC despite being a pure settings
// write (no push stream, no live-BrowserWindow need) — its remote:* siblings
// were all already routes. getHostServices().sync.setAutoSync (electron/main.ts) does the
// full original operation: persist versionHistory.autoSync, then re-arm or
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
