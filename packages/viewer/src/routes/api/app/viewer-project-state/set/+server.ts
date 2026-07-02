import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string; state?: Record<string, unknown> };
    const projectDir = body.projectDir;
    const patch = body.state;
    if (!projectDir || typeof projectDir !== 'string') return json({ ok: false });
    const hooks = getPrefsHooks();
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
