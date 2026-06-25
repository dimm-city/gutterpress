import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';

export const POST: RequestHandler = async () => {
  try {
    const { dialog, BrowserWindow, app } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return json(null);
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a template folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    const templatesRoot = join(app.getPath('userData'), 'templates');
    const lib = await import('@dimm-city/print-md');
    const result = await lib.importTemplateFromFolder({
      sourceDir: res.filePaths[0]!,
      templatesRoot,
    });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};
