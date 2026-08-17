import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The project's stylesheet, fully inlined — what the rich editor renders with.
 *
 * The editing surface shows the author's text at print size using the BOOK'S
 * own CSS, so it needs the same bytes the built book gets. `resolveProjectCss`
 * runs the same two steps `renderChapters` does, so the editor and the PDF
 * cannot end up on different stylesheets.
 *
 * Host-side by necessity (CLAUDE.md §8): the inliner uses `node:fs` and
 * postcss, neither of which may reach the client bundle — hence `loadLib()`
 * rather than an import in the SPA.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'project/inline-css'),
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.resolveProjectCss(body.projectDir);
  },
});
