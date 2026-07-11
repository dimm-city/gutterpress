import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => {
    const prefs = await hooks.readPrefs();
    const lastProjectDir = await hooks.existingDirectory(prefs.lastProjectDir as string | undefined);
    return { ...prefs, lastProjectDir };
  },
});

export const POST: RequestHandler = defineRoute<Record<string, unknown>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ body, hooks }) => {
    // Atomic read-modify-write: this route races the api:preview open flow's
    // recents/lastProjectDir stamp (the start screen's startup toggle fires
    // exactly while the startup open runs), so the patch must compose.
    await hooks.updatePrefs((current) => ({ ...current, ...body }));
    return { ok: true };
  },
});
