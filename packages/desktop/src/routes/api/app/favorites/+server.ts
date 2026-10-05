import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const prefs = await getHostServices().prefs.readPrefs();
    const favorites = (prefs.favorites as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
    return Promise.all(
      favorites.map(async (f) => ({
        ...f,
        exists: (await getHostServices().prefs.existingDirectory(f.path)) !== null,
      })),
    );
  },
});
