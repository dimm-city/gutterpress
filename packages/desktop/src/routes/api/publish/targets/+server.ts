import { handlePublishErrors, publishDeps } from '../_hooks';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Change the book's targets (ADR 0012 §3): `publish:` in the manifest, shared
 * with everyone who has the book, written in the new form (the lib's
 * `setBookTargets`). Resolves with the book's plan as the cards report it.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; targets: string[] }>({
  // In `validate`, not `call` — see handlePublishErrors.
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; targets?: unknown };
    if (!Array.isArray(body.targets) || body.targets.some((t) => typeof t !== 'string')) {
      throw new Error('publish:targets requires { targets: string[] }');
    }
    return {
      projectDir: await requireProjectDir(body.projectDir, 'publish:targets'),
      targets: body.targets as string[],
    };
  },
  call: async ({ body }) =>
    handlePublishErrors('publish:targets', async () => {
      const lib = await loadLib();
      const known = (await lib.listBookPublishProviders({ projectDir: body.projectDir })).map((p) => p.id);
      const unknown = body.targets.filter((t) => !known.includes(t));
      if (unknown.length > 0) throw new Error(`Unknown target "${unknown[0]}". Available: ${known.join(', ')}.`);
      await lib.setBookTargets(body.projectDir, body.targets);
      return lib.publishPlan({ projectDir: body.projectDir }, (await publishDeps()).selections);
    }),
});
