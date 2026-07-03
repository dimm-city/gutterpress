import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  return hooks.readSettings();
});

export const POST: RequestHandler = jsonRoute(async (patch: Record<string, unknown>) => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const current = await hooks.readSettings();
  await hooks.writeSettings(hooks.mergeSettings(current, patch));
  return { ok: true };
});
