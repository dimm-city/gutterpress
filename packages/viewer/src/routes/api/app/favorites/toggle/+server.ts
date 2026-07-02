import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

interface FolderEntry { path: string; title: string }

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { path?: string; title?: string };
    const folderPath = body.path;
    const title = body.title ?? '';
    if (!folderPath || typeof folderPath !== 'string') return error(400, 'path is required');
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    const { favorites, favorited } = hooks.toggleFavoriteFolder(
      current.favorites as FolderEntry[] | undefined,
      { path: folderPath, title }
    );
    await hooks.writePrefs({ ...current, favorites });
    return json({ favorited });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
