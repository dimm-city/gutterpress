import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const prefs = await hooks.readPrefs();
  const recents = (prefs.recentFolders as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
  return Promise.all(
    recents.map(async (r) => ({
      ...r,
      exists: (await hooks.existingDirectory(r.path)) !== null,
    }))
  );
});
