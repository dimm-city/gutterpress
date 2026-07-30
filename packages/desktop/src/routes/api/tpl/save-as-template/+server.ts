import { join } from 'node:path';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<
  { projectDir: string; name: string; sharedRefs?: 'vendor' | 'exclude' },
  DesktopHooks
>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => {
    const body = raw as Record<string, unknown>;
    const projectDir = await requireProjectDir(body.projectDir, 'tpl/save-as-template');
    const name = typeof body.name === 'string' ? body.name : '';
    // How to handle a repo-nested book's `../../shared/...` refs (default vendor
    // — see the lib's SharedRefMode); only the two known values pass through.
    const sharedRefs = body.sharedRefs === 'exclude' ? 'exclude' : 'vendor';
    return { projectDir, name, sharedRefs };
  },
  call: async ({ body, hooks }) => {
    const templatesRoot = join(hooks.getUserDataPath(), 'templates');
    const lib = await loadLib();
    return lib.saveProjectAsTemplate({
      projectDir: body.projectDir,
      name: body.name,
      templatesRoot,
      sharedRefs: body.sharedRefs,
    });
  },
});
