import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

// The book's stylesheet as the build assembles it — core's CSS, every enabled
// extension's (its files and its `css` export, each in its cascade layer),
// every `styles:` sheet — as ordered chunks tagged with their origin, each
// with its root-level `:root` custom properties. Book setup's design settings
// read it (#454). postcss work, so it runs here, host-side, like
// `lint/check-css` (architecture rules §8).
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string };
    return { projectDir: await requireProjectDir(body.projectDir, 'style/book-css') };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.readBookCss(body.projectDir);
  },
});
