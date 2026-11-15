import { handlePublishErrors, publishDeps } from '../_hooks';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Add one target to the book or take it out (ADR 0012 §3): `publish:` in the
 * manifest, shared with everyone who has the book, written in the new form
 * (the lib's `setBookTarget`). The book's other targets stay as they are.
 * Resolves with the book's plan as the cards report it.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; target: string; inBook: boolean }>({
  // In `validate`, not `call` — see handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; target?: unknown; inBook?: unknown };
    if (typeof body.target !== 'string' || typeof body.inBook !== 'boolean') {
      throw new Error('publish:targets requires { target: string, inBook: boolean }');
    }
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:targets'),
      target: body.target,
      inBook: body.inBook,
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:targets', async () => {
      const lib = await loadLib();
      if (body.inBook) {
        const known = (await lib.listBookPublishProviders({ projectDir: body.projectDir })).map((p) => p.id);
        if (!known.includes(body.target)) throw new Error(`Unknown target "${body.target}". Available: ${known.join(', ')}.`);
      }
      await lib.setBookTarget(body.projectDir, body.target, body.inBook);
      return lib.publishPlan({ projectDir: body.projectDir }, (await publishDeps()).selections);
    }),
});
