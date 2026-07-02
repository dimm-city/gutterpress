import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const prefs = await hooks.readPrefs();
    const lastProjectDir = await hooks.existingDirectory(prefs.lastProjectDir as string | undefined);
    return json({ ...prefs, lastProjectDir });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const patch = await request.json().catch(() => ({})) as Record<string, unknown>;
    const hooks = getPrefsHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({ ...current, ...patch });
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
