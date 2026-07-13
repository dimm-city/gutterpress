import { error } from '@sveltejs/kit';
import { getSyncSettingsHooks, type SyncSettingsHooks } from '../../../../../electron/server-bridge/sync-settings-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The queryable counterpart to the fire-and-forget "sync:status" push
// channel: returns the last status the host emitted for a project (or null).
// The status pill seeds itself from this right after subscribing, so a
// subscription that lands after an emit — project open racing the pill's
// mount, or the one-shot "connect"/"local" states — no longer strands the UI
// on blank/stale status. Pure request/response, so a route (§8 A), not IPC.
export const POST: RequestHandler = defineRoute<{ projectDir: string }, SyncSettingsHooks>({
  hooks: getSyncSettingsHooks,
  hooksUnavailableMessage: 'Sync settings hooks not registered',
  validate: (raw) => {
    const body = raw as { projectDir?: unknown };
    if (typeof body.projectDir !== 'string' || !body.projectDir) {
      error(400, 'sync:status requires a projectDir');
    }
    return { projectDir: body.projectDir };
  },
  call: ({ hooks, body }) => hooks.getStatus(body.projectDir),
});
