import { error } from '@sveltejs/kit';
import { defineRoute, loadApiLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

type Change = Parameters<Awaited<ReturnType<typeof loadApiLib>>['setPageSetup']>[1];

/**
 * Change a book's page geometry in the manifest: the size (`preset:` + `page:`
 * bounds), the margins (`page.margin`), or both; a part left out stays as
 * recorded (#357).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; change: Change }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; change?: Change };
    const projectDir = await requireProjectDir(body.projectDir, 'page-size/set');
    const change = body.change;
    const hasSize = typeof change?.size === 'object' && change.size !== null && typeof change.size.preset === 'string';
    const hasMargins = typeof change?.margins === 'object' && change.margins !== null;
    if (!change || (!hasSize && !hasMargins)) {
      error(400, 'page-size/set requires a change with a size or margins');
    }
    return { projectDir, change };
  },
  call: async ({ body }) => {
    const lib = await loadApiLib();
    return lib.setPageSetup(body.projectDir, body.change);
  },
});
