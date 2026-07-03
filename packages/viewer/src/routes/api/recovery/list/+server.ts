import { error } from '@sveltejs/kit';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const { projectDir } = body;
  if (!projectDir) error(400, 'projectDir is required');
  requireAbsolute(projectDir, 'recovery:list');

  const hooks = getRecoveryHooks();
  if (!hooks) error(503, 'Recovery hooks not registered');

  return hooks.list(projectDir);
});
