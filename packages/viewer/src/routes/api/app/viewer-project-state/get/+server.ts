import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  readProjectState: (states: Record<string, unknown> | undefined, dir: string) => unknown;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const projectDir = body.projectDir;
    if (!projectDir || typeof projectDir !== 'string') return json(null);
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const prefs = await hooks.readPrefs();
    const state = hooks.readProjectState(prefs.projectStates as Record<string, unknown> | undefined, projectDir);
    return json(state ?? null);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
