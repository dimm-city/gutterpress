import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const { projectDir } = body;
    if (!projectDir) return error(400, 'projectDir is required');
    if (!path.isAbsolute(projectDir)) return error(400, `recovery:list requires an absolute path, got: ${projectDir}`);

    const hooks = getRecoveryHooks();
    if (!hooks) return error(503, 'Recovery hooks not registered');

    const result = await hooks.list(projectDir);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
