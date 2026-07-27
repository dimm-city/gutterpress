import { error } from '@sveltejs/kit';
import { getDesktopHooks } from '../../../../../electron/server-bridge/host-hooks';
import { defineRoute, loadLib, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  packageName: string;
  exportName?: string;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; packageName?: string; exportName?: string };
    const projectDir = requireAbsolute(body.projectDir, 'plugin/add-npm');
    await requireWithinProjectRoot(projectDir, 'plugin:addNpm');
    if (typeof body.packageName !== 'string' || !body.packageName.trim()) {
      error(400, 'plugin/add-npm requires a packageName');
    }
    if (body.exportName !== undefined && (typeof body.exportName !== 'string' || !body.exportName.trim())) {
      error(400, 'plugin/add-npm exportName must be a non-empty string');
    }
    return {
      projectDir,
      packageName: body.packageName.trim(),
      ...(body.exportName ? { exportName: body.exportName.trim() } : {}),
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const isBundled = lib.RECOMMENDED_PLUGINS.some((plugin) => plugin.name === body.packageName);
    if (!isBundled) {
      const hooks = getDesktopHooks();
      if (!hooks) error(503, 'Desktop hooks not registered');
      if (!(await hooks.confirmNpmPluginInstall(body.packageName))) return null;
    }
    return lib.addNpmPlugin(body.projectDir, body.packageName, body.exportName);
  },
});
