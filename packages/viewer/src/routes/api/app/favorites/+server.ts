import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const prefs = await hooks.readPrefs();
    const favorites = (prefs.favorites as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
    const result = await Promise.all(
      favorites.map(async (f) => ({
        ...f,
        exists: (await hooks.existingDirectory(f.path)) !== null,
      }))
    );
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
