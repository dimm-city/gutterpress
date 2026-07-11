import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => {
    const prefs = await hooks.readPrefs();
    const searchRoots = prefs.projectSearchRoots as string[] | undefined;
    const roots =
      searchRoots && searchRoots.length > 0 ? searchRoots : hooks.defaultProjectSearchRoots();
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
  },
});
