import { error } from '@sveltejs/kit';
import { defineRoute, getHostServices } from '../../../_lib/route';
import type { RequestHandler } from './$types';

interface FolderEntry { path: string; title: string }

export const POST: RequestHandler = defineRoute<{ path: string; title: string }>({
  validate: (raw) => {
    const body = raw as { path?: string; title?: string };
    if (!body.path || typeof body.path !== 'string') error(400, 'path is required');
    return { path: body.path, title: body.title ?? '' };
  },
  call: async ({ body }) => {
    let favorited = false;
    await getHostServices().prefs.updatePrefs((current) => {
      const result = getHostServices().prefs.toggleFavoriteFolder(
        current.favorites as FolderEntry[] | undefined,
        { path: body.path, title: body.title },
      );
      favorited = result.favorited;
      return { ...current, favorites: result.favorites };
    });
    return { favorited };
  },
});
