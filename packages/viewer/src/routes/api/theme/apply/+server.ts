import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, target } = await request.json().catch(() => ({})) as {
      projectDir?: string;
      target?: { kind: 'builtin' | 'project'; id: string };
    };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'theme/apply requires an absolute projectDir');
    }
    if (!target || typeof target.kind !== 'string' || typeof target.id !== 'string') {
      return error(400, 'theme/apply requires a target { kind, id }');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.applyTheme(projectDir, target));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
