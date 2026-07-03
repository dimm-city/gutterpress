import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = jsonRoute(async () => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const prefs = await hooks.readPrefs();
  const lastProjectDir = await hooks.existingDirectory(prefs.lastProjectDir as string | undefined);
  return { ...prefs, lastProjectDir };
});

export const POST: RequestHandler = jsonRoute(async (patch: Record<string, unknown>) => {
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const current = await hooks.readPrefs();
  await hooks.writePrefs({ ...current, ...patch });
  return { ok: true };
});
