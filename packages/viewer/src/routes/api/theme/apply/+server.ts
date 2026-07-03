import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: {
    projectDir?: string;
    target?: { kind: 'builtin' | 'project'; id: string };
  }) => {
    const { projectDir, target } = body;
    if (!projectDir || !isAbsolute(projectDir)) {
      error(400, 'theme/apply requires an absolute projectDir');
    }
    if (!target || typeof target.kind !== 'string' || typeof target.id !== 'string') {
      error(400, 'theme/apply requires a target { kind, id }');
    }
    const lib = await import('@dimm-city/print-md');
    return lib.applyTheme(projectDir, target);
  }
);
