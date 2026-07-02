import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const prefs = await hooks.readPrefs();
    const recents = (prefs.recentFolders as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
    const result = await Promise.all(
      recents.map(async (r) => ({
        ...r,
        exists: (await hooks.existingDirectory(r.path)) !== null,
      }))
    );
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
