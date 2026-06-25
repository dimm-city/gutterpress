import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  loadLib: () => Promise<{
    detectProjectSource: (path: string) => Promise<unknown>;
    capabilitiesFor: (source: unknown) => unknown;
    scaffoldProject: (opts: unknown) => Promise<unknown>;
    adoptFolder: (opts: unknown) => Promise<unknown>;
  }>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const folderPath = body.projectDir;
    if (!folderPath || typeof folderPath !== 'string') return error(400, "'projectDir' string is required");
    const hooks = getHooks();
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
