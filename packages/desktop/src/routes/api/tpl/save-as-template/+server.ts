import { join } from 'node:path';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string; name: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => {
    const body = raw as Record<string, unknown>;
    const projectDir = await requireProjectDir(body.projectDir, 'tpl/save-as-template');
    const name = typeof body.name === 'string' ? body.name : '';
    return { projectDir, name };
  },
  call: async ({ body, hooks }) => {
    const templatesRoot = join(hooks.getUserDataPath(), 'templates');
    const lib = await loadLib();
    return lib.saveProjectAsTemplate({ projectDir: body.projectDir, name: body.name, templatesRoot });
  },
});
