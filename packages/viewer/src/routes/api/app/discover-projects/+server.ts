import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async () => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const prefs = await hooks.readPrefs();
  const searchRoots = prefs.projectSearchRoots as string[] | undefined;
  const roots =
    searchRoots && searchRoots.length > 0
      ? searchRoots
      : hooks.defaultProjectSearchRoots();
  const recentFolders = prefs.recentFolders as Array<{ path: string }> | undefined;
  const favorites = prefs.favorites as Array<{ path: string }> | undefined;
  const exclude = new Set<string>([
    ...(recentFolders ?? []).map((r) => r.path),
    ...(favorites ?? []).map((f) => f.path),
  ]);
  try {
    return await hooks.scanForProjects(roots, exclude);
  } catch {
    return [];
  }
});
