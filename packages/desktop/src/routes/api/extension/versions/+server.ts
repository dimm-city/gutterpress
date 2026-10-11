import { error } from '@sveltejs/kit';
import { defineRoute, loadLib } from '../../_lib/route';
import type { RequestHandler } from './$types';

// Every published version of one npm package, newest first (pre-releases
// included — the Features tab's version picker filters them by the author's
// "Include pre-release versions" preference). Read from the same abbreviated
// registry metadata the update check uses, fetched ON DEMAND when the tab
// opens or a picker is opened — never at project load. A fetch failure is
// DATA, not a 500, like `extension/search` and `extension/outdated`: the row
// shows one quiet line and nothing else is blocked. Switching versions is the
// ordinary `extension/add` with `name@version`, behind the same trust gate.
export const POST: RequestHandler = defineRoute<{ name: string }>({
  validate: async (raw) => {
    const name = (raw as { name?: unknown }).name;
    if (typeof name !== 'string' || !name.trim()) error(400, 'extension/versions requires a package name');
    const lib = await loadLib();
    let parsed: ReturnType<typeof lib.parseExtensionSpecifier>;
    try {
      parsed = lib.parseExtensionSpecifier(name.trim());
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
    if (parsed.kind !== 'npm' || parsed.version !== undefined) {
      error(400, 'extension/versions takes a bare npm package name');
    }
    return { name: parsed.name };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    try {
      return { ok: true as const, versions: await lib.listNpmVersions(body.name) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) };
    }
  },
});
