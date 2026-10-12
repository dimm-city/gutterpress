import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import { collectClassCatalog } from '../../_lib/class-catalog';
import type { RequestHandler } from './$types';

// The classes the project can write beyond core's own `gp-*` vocabulary: what its
// enabled extensions document in their component catalog (modifiers flagged) and
// what its active stylesheets use. Data only, for the editor's `.class`
// autocomplete and the Block properties dialog — see `_lib/class-catalog.ts`.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'snip/classes'),
  }),
  call: async ({ body }) => collectClassCatalog(body.projectDir, await loadLib()),
});
