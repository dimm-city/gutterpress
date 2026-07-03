import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const prefs = await hooks.readPrefs();
  const favorites = (prefs.favorites as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
  return Promise.all(
    favorites.map(async (f) => ({
      ...f,
      exists: (await hooks.existingDirectory(f.path)) !== null,
    }))
  );
});
