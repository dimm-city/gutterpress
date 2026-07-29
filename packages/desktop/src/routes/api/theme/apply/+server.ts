import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface Body {
  projectDir: string;
  target: { kind: 'builtin' | 'project'; id: string };
}

export const POST: RequestHandler = defineRoute<Body>({
  validate: (raw) => {
    const body = raw as { projectDir?: string; target?: { kind?: string; id?: string } };
    const projectDir = requireAbsolute(body.projectDir, 'theme/apply');
    if (!body.target || typeof body.target.kind !== 'string' || typeof body.target.id !== 'string') {
      error(400, 'theme/apply requires a target { kind, id }');
    }
    return { projectDir, target: body.target as Body['target'] };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.applyTheme(body.projectDir, body.target);
  },
});
