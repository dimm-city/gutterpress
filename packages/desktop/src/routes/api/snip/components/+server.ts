import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The project's plugin components (declared markers) with each one's example
// snippet — see `snippets.ts`'s `listMarkerComponents`. Feeds the editor's
// `@` autocomplete and the snippet picker's Components group.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'snip/components'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listMarkerComponents(body.projectDir);
  },
});
