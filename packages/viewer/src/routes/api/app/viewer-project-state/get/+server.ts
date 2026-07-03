import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const projectDir = body.projectDir;
  if (!projectDir || typeof projectDir !== 'string') return null;
  const hooks = getPrefsHooks();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const prefs = await hooks.readPrefs();
  const state = hooks.readProjectState(prefs.projectStates as Record<string, unknown> | undefined, projectDir);
  return state ?? null;
});
