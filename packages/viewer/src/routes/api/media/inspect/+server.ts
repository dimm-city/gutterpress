import { json, error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from './$types';

interface PrefsHooks {
  loadLib: () => Promise<{
    inspectImage: (filePath: string) => Promise<{
      width: number;
      height: number;
      xDpi: number;
      yDpi: number;
      hasAlpha: boolean;
      colorSpace: 'srgb' | 'gray' | 'cmyk' | '';
    } | null>;
  }>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { imagePath?: string };
    const filePath = body.imagePath;
    if (!filePath || typeof filePath !== 'string') return error(400, "'imagePath' string is required");
    if (!path.isAbsolute(filePath)) return error(400, `media:inspect requires an absolute path, got: ${filePath}`);

    let s;
    try {
      s = await stat(filePath);
    } catch {
      return json(null);
    }

    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    const info = await lib.inspectImage(filePath);
    return json({ fileSize: s.size, info });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
