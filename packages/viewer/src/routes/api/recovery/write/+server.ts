import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      filePath?: string;
      content?: string;
      baseMtimeMs?: number;
    };
    const { filePath, content, baseMtimeMs } = body;
    if (!filePath) return error(400, 'filePath is required');
    if (content === undefined) return error(400, 'content is required');
    if (typeof baseMtimeMs !== 'number') return error(400, 'baseMtimeMs must be a number');
    if (!path.isAbsolute(filePath)) return error(400, `recovery:write requires an absolute path, got: ${filePath}`);

    const hooks = getRecoveryHooks();
    if (!hooks) return error(503, 'Recovery hooks not registered');

    const result = await hooks.write(filePath, content, baseMtimeMs);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
