import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  loadLib: () => Promise<{
    checkCss: (css: string, from?: string) => Array<{
      rule: string;
      severity: 'error' | 'warning';
      message: string;
      line: number;
      column: number;
    }>;
  }>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { cssPath?: string; content?: string };
    const { cssPath, content } = body;
    if (typeof content !== 'string') return error(400, "'content' string is required");

    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    const warnings = lib.checkCss(content, cssPath);
    return json(warnings);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
