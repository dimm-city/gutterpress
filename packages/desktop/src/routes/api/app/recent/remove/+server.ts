import { error } from '@sveltejs/kit';
import { defineRoute, getHostServices } from '../../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ path: string }>({
  validate: (raw) => {
    const body = raw as { path?: string };
    if (!body.path || typeof body.path !== 'string') error(400, 'path is required');
    return { path: body.path };
  },
  call: async ({ body }) => {
    const { prefs } = getHostServices();
    await prefs.updatePrefs((current) => ({
      ...current,
      recentFolders: prefs.removeRecentFolder(current.recentFolders, body.path),
    }));
    return { ok: true };
  },
});
