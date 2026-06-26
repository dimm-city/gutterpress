import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, source } = await request.json().catch(() => ({})) as {
      projectDir?: string | null;
      source?: { kind: 'builtin' | 'project'; id: string };
    };
    if (projectDir != null && (typeof projectDir !== 'string' || !isAbsolute(projectDir))) {
      return error(400, 'theme/read-css requires an absolute projectDir or null');
    }
    if (!source || typeof source.kind !== 'string' || typeof source.id !== 'string') {
      return error(400, 'theme/read-css requires a source { kind, id }');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.readThemeCss(projectDir ?? null, source));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
