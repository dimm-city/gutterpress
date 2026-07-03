import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface ProjectSourceLibModule {
  detectProjectSource: (path: string) => Promise<unknown>;
  capabilitiesFor: (source: unknown) => unknown;
}

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const folderPath = body.projectDir;
  if (!folderPath || typeof folderPath !== 'string') error(400, "'projectDir' string is required");
  const hooks = getPrefsHooks<ProjectSourceLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  const source = await lib.detectProjectSource(folderPath);
  const capabilities = lib.capabilitiesFor(source);
  return { source, capabilities };
});
