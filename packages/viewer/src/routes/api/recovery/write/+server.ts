import { error } from '@sveltejs/kit';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  filePath?: string;
  content?: string;
  baseMtimeMs?: number;
}) => {
  const { filePath, content, baseMtimeMs } = body;
  if (!filePath) error(400, 'filePath is required');
  if (content === undefined) error(400, 'content is required');
  if (typeof baseMtimeMs !== 'number') error(400, 'baseMtimeMs must be a number');
  requireAbsolute(filePath, 'recovery:write');

  const hooks = getRecoveryHooks();
  if (!hooks) error(503, 'Recovery hooks not registered');

  return hooks.write(filePath, content, baseMtimeMs);
});
