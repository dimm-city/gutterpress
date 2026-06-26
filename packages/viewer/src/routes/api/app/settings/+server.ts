import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  readSettings: () => Promise<Record<string, unknown>>;
  writeSettings: (settings: Record<string, unknown>) => Promise<void>;
  mergeSettings: (base: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const GET: RequestHandler = async () => {
  try {
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    return json(await hooks.readSettings());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const patch = await request.json().catch(() => ({})) as Record<string, unknown>;
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readSettings();
    await hooks.writeSettings(hooks.mergeSettings(current, patch));
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
