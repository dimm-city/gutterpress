import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #246: the curated extension index (`site/extensions.json`), fetched on
// demand — never at project load, never by the loader/build/preview paths.
// A fetch/parse failure is DATA, not a 500: the panel shows one quiet line
// and the local extension list is never blocked by a flaky network.
export const GET: RequestHandler = defineRoute({
  call: async () => {
    const lib = await loadLib();
    try {
      const entries = await lib.fetchExtensionIndex();
      return { ok: true as const, entries };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  },
});
