import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface InspectImageLibModule {
  inspectImage: (filePath: string) => Promise<{
    width: number;
    height: number;
    xDpi: number;
    yDpi: number;
    hasAlpha: boolean;
    colorSpace: 'srgb' | 'gray' | 'cmyk' | '';
  } | null>;
}

export const POST: RequestHandler = jsonRoute(async (body: { imagePath?: string }) => {
  const filePath = body.imagePath;
  if (!filePath || typeof filePath !== 'string') error(400, "'imagePath' string is required");
  requireAbsolute(filePath, 'media:inspect');

  let s;
  try {
    s = await stat(filePath);
  } catch {
    return null;
  }

  const hooks = getPrefsHooks<InspectImageLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  const info = await lib.inspectImage(filePath);
  return { fileSize: s.size, info };
});
