import { error } from '@sveltejs/kit';
import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

type Choice = Parameters<Awaited<ReturnType<typeof loadApiLib>>['setPageSetup']>[1];

/**
 * Change a book's page size: the manifest's `preset:` + `page:` bounds and the
 * stylesheet's `@page` size, written together by the lib (#357).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; choice: Choice }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; choice?: Choice };
    const projectDir = await requireProjectDir(body.projectDir, 'page-size/set');
    if (!body.choice || typeof body.choice !== 'object' || typeof body.choice.preset !== 'string') {
      error(400, 'page-size/set requires a choice with a preset');
    }
    return { projectDir, choice: body.choice };
  },
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.setPageSetup(body.projectDir, body.choice);
  },
});
