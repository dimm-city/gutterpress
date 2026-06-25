import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, ref, enabled } = await request.json().catch(() => ({})) as {
      projectDir?: string;
      ref?: string;
      enabled?: boolean;
    };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'plugin/set-enabled requires an absolute projectDir');
    }
    if (typeof ref !== 'string') {
      return error(400, 'plugin/set-enabled requires a ref string');
    }
    const lib = await import('@dimm-city/print-md');
    await lib.setPluginEnabled(projectDir, ref, Boolean(enabled));
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
