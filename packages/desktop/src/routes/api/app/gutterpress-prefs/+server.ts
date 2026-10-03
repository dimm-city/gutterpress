import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => {
    const prefs = await getHostServices().prefs.readPrefs();
    const lastProjectDir = await getHostServices().prefs.existingDirectory(prefs.lastProjectDir as string | undefined);
    return { ...prefs, lastProjectDir };
  },
});

export const POST: RequestHandler = defineRoute<Record<string, unknown>>({
  call: async ({ body }) => {
    // Atomic read-modify-write: this route races the api:preview open flow's
    // recents/lastProjectDir stamp (the start screen's startup toggle fires
    // exactly while the startup open runs), so the patch must compose.
    await getHostServices().prefs.updatePrefs((current) => ({ ...current, ...body }));
    return { ok: true };
  },
});
