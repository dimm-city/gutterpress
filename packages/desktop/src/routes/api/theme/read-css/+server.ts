import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface Body {
  projectDir: string | null;
  source: { kind: 'builtin' | 'project'; id: string };
}

export const POST: RequestHandler = defineRoute<Body>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string | null; source?: { kind?: string; id?: string } };
    const { projectDir, source } = body;
    // A null projectDir is the built-in-theme read (no project involved); a
    // non-null one names a directory this route reads a `themes/<id>/theme.css`
    // out of, so it gets the same containment check as every other
    // project-scoped route.
    if (projectDir != null) await requireProjectDir(projectDir, 'theme/read-css');
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
