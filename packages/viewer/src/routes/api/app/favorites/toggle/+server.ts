import { error } from '@sveltejs/kit';
import { getPrefsHooks, type PrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../../_lib/route';
import type { RequestHandler } from './$types';

interface FolderEntry { path: string; title: string }

export const POST: RequestHandler = defineRoute<{ path: string; title: string }, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  validate: (raw) => {
    const body = raw as { path?: string; title?: string };
    if (!body.path || typeof body.path !== 'string') error(400, 'path is required');
    return { path: body.path, title: body.title ?? '' };
  },
  call: async ({ body, hooks }) => {
    let favorited = false;
    await hooks.updatePrefs((current) => {
      const result = hooks.toggleFavoriteFolder(
        current.favorites as FolderEntry[] | undefined,
        { path: body.path, title: body.title },
      );
      favorited = result.favorited;
      return { ...current, favorites: result.favorites };
    });
    return { favorited };
  },
});
