import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(
  async (body: {
    projectDir?: string | null;
    source?: { kind: 'builtin' | 'project'; id: string };
  }) => {
    const { projectDir, source } = body;
    if (projectDir != null && (typeof projectDir !== 'string' || !isAbsolute(projectDir))) {
      error(400, 'theme/read-css requires an absolute projectDir or null');
    }
    if (!source || typeof source.kind !== 'string' || typeof source.id !== 'string') {
      error(400, 'theme/read-css requires a source { kind, id }');
    }
    const lib = await import('@dimm-city/print-md');
    return lib.readThemeCss(projectDir ?? null, source);
  }
);
