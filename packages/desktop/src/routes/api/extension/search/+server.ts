import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #246: search npm for extensions (packages tagged `gutterpress` or
// `markdown-it-plugin`), fetched on demand — never at project load, never by
// the loader/build/preview paths. A fetch/parse failure is DATA, not a 500:
// the panel shows one quiet line and the local extension list is never
// blocked by a flaky network.
export const POST: RequestHandler = defineRoute<{ query: string }>({
  validate: async (raw) => ({
    query: typeof (raw as { query?: unknown }).query === 'string' ? (raw as { query: string }).query : '',
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    try {
      const { matches, total } = await lib.searchNpmExtensions(body.query);
      return { ok: true as const, matches, total };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  },
});
