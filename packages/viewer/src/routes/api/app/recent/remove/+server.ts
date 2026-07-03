import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../../_lib/handler';
import type { RequestHandler } from './$types';

interface RecentFolder { path: string; [k: string]: unknown }

export const POST: RequestHandler = jsonRoute(async (body: { path?: string }) => {
  const folderPath = body.path;
  if (!folderPath || typeof folderPath !== 'string') error(400, 'path is required');
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const current = await hooks.readPrefs();
  await hooks.writePrefs({
    ...current,
    recentFolders: hooks.removeRecentFolder(current.recentFolders as RecentFolder[] | undefined, folderPath),
  });
  return { ok: true };
});
