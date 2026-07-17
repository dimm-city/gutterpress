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
    // Atomic read-merge-write (audit A2): a bare readSettings()+writeSettings()
    // pair here raced concurrent setting changes and silently reverted one.
    await hooks.updateSettings(body);
    return { ok: true };
  },
});
