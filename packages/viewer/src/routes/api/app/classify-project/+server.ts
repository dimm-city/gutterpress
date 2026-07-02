import { json, error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import type { RequestHandler } from './$types';

interface ProjectSourceLibModule {
  detectProjectSource: (path: string) => Promise<unknown>;
  capabilitiesFor: (source: unknown) => unknown;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const folderPath = body.projectDir;
    if (!folderPath || typeof folderPath !== 'string') return error(400, "'projectDir' string is required");
    const hooks = getPrefsHooks<ProjectSourceLibModule>();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    const source = await lib.detectProjectSource(folderPath);
    const capabilities = lib.capabilitiesFor(source);
    return json({ source, capabilities });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
