import { getPrefsHooks, type PrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = defineRoute<Record<string, never>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ hooks }) => hooks.readSettings(),
});

export const POST: RequestHandler = defineRoute<Record<string, unknown>, PrefsHooks>({
  hooks: getPrefsHooks,
  hooksUnavailableMessage: 'Prefs hooks not registered',
  call: async ({ body, hooks }) => {
    const current = await hooks.readSettings();
    await hooks.writeSettings(hooks.mergeSettings(current, body));
    return { ok: true };
  },
});
