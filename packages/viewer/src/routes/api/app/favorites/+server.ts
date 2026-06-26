import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
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
    const favorites = (prefs.favorites as Array<{ path: string; [k: string]: unknown }> | undefined) ?? [];
    const result = await Promise.all(
      favorites.map(async (f) => ({
        ...f,
        exists: (await hooks.existingDirectory(f.path)) !== null,
      }))
    );
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
