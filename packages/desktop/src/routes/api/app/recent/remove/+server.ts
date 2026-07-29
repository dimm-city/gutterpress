import { error } from '@sveltejs/kit';
import { getPrefsHooks, type PrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

interface RecentFolder { path: string; [k: string]: unknown }

export const POST: RequestHandler = defineRoute<{ path: string }, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => {
    const body = raw as { path?: string };
    if (!body.path || typeof body.path !== 'string') error(400, 'path is required');
    return { path: body.path };
  },
  call: async ({ body, hooks }) => {
    await hooks.updatePrefs((current) => ({
      ...current,
      recentFolders: hooks.removeRecentFolder(current.recentFolders as RecentFolder[] | undefined, body.path),
    }));
    return { ok: true };
  },
});
