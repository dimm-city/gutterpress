import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: { projectDir?: string; state?: Record<string, unknown> }) => {
    const projectDir = body.projectDir;
    const patch = body.state;
    if (!projectDir || typeof projectDir !== 'string') return { ok: false };
    const hooks = getPrefsHooks();
    if (!hooks) error(503, 'Prefs hooks not registered');
    const current = await hooks.readPrefs();
    await hooks.writePrefs({
      ...current,
      lastProjectDir: projectDir,
      projectStates: hooks.writeProjectState(current.projectStates as Record<string, unknown> | undefined, projectDir, (patch ?? {}) as Record<string, unknown>),
    });
    return { ok: true };
  }
);
