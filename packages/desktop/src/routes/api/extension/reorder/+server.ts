import { error } from '@sveltejs/kit';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: rewrite the list in the given order — the author's CSS cascade AND
// markdown registration order (later wins ties). `order` must name every
// configured `use` exactly once; the lib refuses a stale or partial view.
export const POST: RequestHandler = defineRoute<{ projectDir: string; order: string[] }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; order?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/reorder');
    if (!Array.isArray(body.order) || !body.order.every((u) => typeof u === 'string' && u.trim())) {
      error(400, 'extension/reorder requires order: string[]');
    }
    return { projectDir, order: body.order as string[] };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    await lib.reorderExtensions(body.projectDir, body.order);
    return { ok: true };
  },
});
