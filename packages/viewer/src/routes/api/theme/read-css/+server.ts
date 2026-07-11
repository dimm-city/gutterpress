import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface Body {
  projectDir: string | null;
  source: { kind: 'builtin' | 'project'; id: string };
}

export const POST: RequestHandler = defineRoute<Body>({
  validate: (raw) => {
    const body = raw as { projectDir?: string | null; source?: { kind?: string; id?: string } };
    const { projectDir, source } = body;
    if (projectDir != null && (typeof projectDir !== 'string' || !isAbsolute(projectDir))) {
      error(400, 'theme/read-css requires an absolute projectDir or null');
    }
    if (!source || typeof source.kind !== 'string' || typeof source.id !== 'string') {
      error(400, 'theme/read-css requires a source { kind, id }');
    }
    return { projectDir: projectDir ?? null, source: source as Body['source'] };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.readThemeCss(body.projectDir, body.source);
  },
});
