import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir } = await request.json().catch(() => ({})) as { projectDir?: string };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'theme/import-from-folder requires an absolute projectDir');
    }
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return json(null);
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a theme folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    const lib = await import('@dimm-city/print-md');
    return json(await lib.importThemeFromFolder(projectDir, res.filePaths[0]!));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
