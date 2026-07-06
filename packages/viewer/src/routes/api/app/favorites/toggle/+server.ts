import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../../_lib/handler';
import type { RequestHandler } from './$types';

interface FolderEntry { path: string; title: string }

export const POST: RequestHandler = jsonRoute(async (body: { path?: string; title?: string }) => {
  const folderPath = body.path;
  const title = body.title ?? '';
  if (!folderPath || typeof folderPath !== 'string') error(400, 'path is required');
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  let favorited = false;
  await hooks.updatePrefs((current) => {
    const result = hooks.toggleFavoriteFolder(
      current.favorites as FolderEntry[] | undefined,
      { path: folderPath, title }
    );
    favorited = result.favorited;
    return { ...current, favorites: result.favorites };
  });
  return { favorited };
});
