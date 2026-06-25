import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  writePrefs: (prefs: Record<string, unknown>) => Promise<void>;
  existingDirectory: (dir: string | undefined) => Promise<string | null>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const GET: RequestHandler = async () => {
  try {
    const hooks = getHooks();
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
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({ ...current, ...patch });
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
