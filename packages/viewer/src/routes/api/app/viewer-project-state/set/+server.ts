import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  readPrefs: () => Promise<Record<string, unknown>>;
  writePrefs: (prefs: Record<string, unknown>) => Promise<void>;
  writeProjectState: (states: Record<string, unknown> | undefined, dir: string, patch: Record<string, unknown>) => Record<string, unknown>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string; state?: Record<string, unknown> };
    const projectDir = body.projectDir;
    const patch = body.state;
    if (!projectDir || typeof projectDir !== 'string') return json({ ok: false });
    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({
      ...current,
      lastProjectDir: projectDir,
      projectStates: hooks.writeProjectState(current.projectStates as Record<string, unknown> | undefined, projectDir, (patch ?? {}) as Record<string, unknown>),
    });
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
