import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The page / chapter / section variants the project can use (`@page blank`,
// `@section card`): core's own plus each enabled extension's — see
// `snippets.ts`'s `listLocationVariants`. Data only, for a picker.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'snip/variants'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listLocationVariants(body.projectDir);
  },
});
