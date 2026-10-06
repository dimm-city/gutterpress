import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Each pinned npm extension against npm's `latest`, fetched ON DEMAND when the
// Features tab opens or the author asks — never at project load, never by the
// loader/build/preview paths (a book builds offline from its vendored copy).
// A fetch failure is DATA, not a 500: the tab shows one quiet line and the
// extension list itself is never blocked by the network. Updating is the
// ordinary `extension/add` with `name@latest`, behind the same trust gate.
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'extension/outdated'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    try {
      const checks = await lib.checkExtensionUpdates(body.projectDir);
      return { ok: true as const, checks };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  },
});
