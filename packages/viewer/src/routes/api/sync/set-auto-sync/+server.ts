import { error } from '@sveltejs/kit';
import { getSyncSettingsHooks, type SyncSettingsHooks } from '../../../../../electron/server-bridge/sync-settings-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// ARCH review #8: sync:setAutoSync was IPC despite being a pure settings
// write (no push stream, no live-BrowserWindow need) — its remote:* siblings
// were all already routes. hooks.setAutoSync (electron/main.ts) does the
// full original operation: persist versionHistory.autoSync, then re-arm or
// cancel the orchestrator's periodic timer for the open project.
export const POST: RequestHandler = defineRoute<{ enabled: boolean }, SyncSettingsHooks>({
  hooks: getSyncSettingsHooks,
  hooksUnavailableMessage: 'Sync settings hooks not registered',
  validate: (raw) => {
    const body = raw as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      error(400, 'sync:setAutoSync requires a boolean');
    }
    return { enabled: body.enabled };
  },
  call: ({ hooks, body }) => hooks.setAutoSync(body.enabled),
});
