import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => {
    const prefs = await hooks.readPrefs();
    const recents = (prefs.recentFolders as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
    return Promise.all(
      recents.map(async (r) => ({
        ...r,
        exists: (await hooks.existingDirectory(r.path)) !== null,
      })),
    );
  },
});
