import { error } from '@sveltejs/kit';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { filePath?: string }) => {
  const { filePath } = body;
  if (!filePath) error(400, 'filePath is required');
  requireAbsolute(filePath, 'recovery:clear');

  const hooks = getRecoveryHooks();
  if (!hooks) error(503, 'Recovery hooks not registered');

  return hooks.clear(filePath);
});
