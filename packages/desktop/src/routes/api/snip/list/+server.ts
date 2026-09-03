import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #242: the project's own snippets merged with every installed, active
// extension's declared `snippets` folder — see `snippets.ts`'s
// `listMergedSnippets` for precedence/provenance/removal. The route itself
// is unchanged shape (still just `{ projectDir } -> SnippetEntry[]`); only
// which lib function it calls changed, so the picker's existing fetch call
// picks up extension snippets with no route-surface change on its side.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'snip/list'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listMergedSnippets(body.projectDir);
  },
});
