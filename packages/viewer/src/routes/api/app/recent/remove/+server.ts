import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

interface RecentFolder { path: string; [k: string]: unknown }

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string };
    const folderPath = body.path;
    if (!folderPath || typeof folderPath !== 'string') return error(400, 'path is required');
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({
      ...current,
      recentFolders: hooks.removeRecentFolder(current.recentFolders as RecentFolder[] | undefined, folderPath),
    });
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
